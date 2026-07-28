export type SubAgentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubAgentTaskSnapshot {
  id: string;
  label: string;
  background: boolean;
  status: SubAgentTaskStatus;
  turn: number;
  lastTool?: string;
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface SubAgentTaskContext {
  signal: AbortSignal;
  onProgress: (progress: { turn?: number; lastTool?: string }) => void;
}

interface StartSubAgentTaskBaseOptions {
  //UI 显示的任务名称
  label: string;
  //是否为后台任务
  background: boolean;
  //是否跟随父请求取消
  parentSignal?: AbortSignal;
}

type SubAgentTaskRunner = (
  context: SubAgentTaskContext,
) => Promise<string>;

/**
 * `run` is the canonical task runner name. `runTask` remains accepted while
 * existing callers migrate, but callers must provide at least one runner.
 */
export type StartSubAgentTaskOptions = StartSubAgentTaskBaseOptions & (
  | {
      run: SubAgentTaskRunner;
      /** @deprecated Use `run` instead. */
      runTask?: SubAgentTaskRunner;
    }
  | {
      run?: never;
      /** @deprecated Use `run` instead. */
      runTask: SubAgentTaskRunner;
    }
);

interface TaskRecord {
  snapshot: SubAgentTaskSnapshot;
  controller: AbortController;
  completion: Promise<SubAgentTaskSnapshot>;
  resolveCompletion: (snapshot: SubAgentTaskSnapshot) => void;
  detachParentAbort?: () => void;
}

type TaskListener = (tasks: SubAgentTaskSnapshot[]) => void;

export class SubAgentTaskManager {
  private nextId = 0;
  private records = new Map<string, TaskRecord>();
  private listeners = new Set<TaskListener>();

  // 创建任务
  createTask(options: StartSubAgentTaskOptions): SubAgentTaskSnapshot {
    const run = options.run ?? options.runTask;
    //生成任务 ID
    const id = `agent-${++this.nextId}`;
    //生成取消控制器
    const controller = new AbortController();
    //手动保存了 Promise 的 resolve 函数
    let resolveCompletion!: (snapshot: SubAgentTaskSnapshot) => void;
    const completion = new Promise<SubAgentTaskSnapshot>((resolve) => {
      resolveCompletion = resolve;
    });
    // 把一些信息以及函数存起来
    const record: TaskRecord = {
      snapshot: {
        id,
        label: options.label,
        background: options.background,
        status: "running",
        turn: 0,
        startedAt: Date.now(),
      },
      controller,
      completion,
      resolveCompletion,
    };
    // 根据id和record的Map存起来，方便读取
    this.records.set(id, record);
    // 如果是跟随父任务取消
    if (options.parentSignal) {
      // 构建一个函数，里面就是记录取消是父任务取消
      const abortFromParent = () => {
        this.cancelRecord(record, "Parent request cancelled");
      };
      // 如果父任务取消了
      if (options.parentSignal.aborted) {
        // 则调用刚才的函数，并且在cancelRecord中记录
        abortFromParent();
      } else {
        // ？？
        options.parentSignal.addEventListener("abort", abortFromParent, { once: true });
        record.detachParentAbort = () =>
          options.parentSignal?.removeEventListener("abort", abortFromParent);
      }
    }
    // 给所有订阅者发送消息
    this.emit();
    // 如果当前的任务状态是running
    if (record.snapshot.status === "running") {
      //启动任务
      void Promise.resolve()
        .then(() => run({
          signal: controller.signal,
          onProgress: (progress) => this.updateProgress(id, progress),
        }))
        .then((output) => this.finish(id, "completed", { output }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            this.finish(id, "cancelled", {
              error: error instanceof Error ? error.message : "Task cancelled",
            });
            return;
          }
          this.finish(id, "failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    return this.copy(record.snapshot);
  }

  get(id: string): SubAgentTaskSnapshot | undefined {
    const record = this.records.get(id);
    return record ? this.copy(record.snapshot) : undefined;
  }

  list(): SubAgentTaskSnapshot[] {
    return [...this.records.values()]
      .map((record) => this.copy(record.snapshot))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  async wait(id: string, timeoutMs?: number): Promise<SubAgentTaskSnapshot | undefined> {
    // 拿到record
    const record = this.records.get(id);
    if (!record) return undefined;
    if (record.snapshot.status !== "running") return this.copy(record.snapshot);
    if (timeoutMs === undefined) return record.completion.then((task) => this.copy(task));
    // 返回一个异步的promise
    return new Promise<SubAgentTaskSnapshot>((resolve) => {
      // 超时的话，就返回当前快照信息
      const timer = setTimeout(
        () => resolve(this.copy(record.snapshot)),
        Math.max(0, timeoutMs),
      );
      //等待completion完成
      void record.completion.then((task) => {
        clearTimeout(timer);
        resolve(this.copy(task));
      });
    });
  }

  stop(id: string): SubAgentTaskSnapshot | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    if (record.snapshot.status === "running") {
      this.cancelRecord(record, "Task stopped");
    }
    return this.copy(record.snapshot);
  }

  remove(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.snapshot.status === "running") return false;
    record.detachParentAbort?.();
    const removed = this.records.delete(id);
    if (removed) this.emit();
    return removed;
  }

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => this.listeners.delete(listener);
  }

  private updateProgress(
    id: string,
    progress: { turn?: number; lastTool?: string },
  ): void {
    const record = this.records.get(id);
    if (!record || record.snapshot.status !== "running") return;
    record.snapshot = { ...record.snapshot, ...progress };
    this.emit();
  }

  private cancelRecord(record: TaskRecord, reason: string): void {
    if (record.snapshot.status !== "running") return;
    record.controller.abort(new Error(reason));
    this.finish(record.snapshot.id, "cancelled", { error: reason });
  }

  // 任务完成
  private finish(
    id: string,
    status: Exclude<SubAgentTaskStatus, "running">,
    result: { output?: string; error?: string },
  ): void {
    // 拿到这个次的任务
    const record = this.records.get(id);
    // 如果任务不存在或者任务的状态不是running，则返回
    if (!record || record.snapshot.status !== "running") return;
    // 更新快照
    record.snapshot = {
      ...record.snapshot,
      ...result,
      status,
      finishedAt: Date.now(),
    };
    // 
    record.detachParentAbort?.();
    record.detachParentAbort = undefined;
    //拿到新的快照对象
    const snapshot = this.copy(record.snapshot);
    // 调用任务的resolve
    record.resolveCompletion(snapshot);
    // 更新UI
    this.emit();
  }

  private emit(): void {
    const tasks = this.list();
    for (const listener of this.listeners) listener(tasks);
  }

  private copy(task: SubAgentTaskSnapshot): SubAgentTaskSnapshot {
    return { ...task };
  }
}
