export interface CompactBoundaryPayload {
    summary: string;
    keep: KeptMessage[];
}
export interface KeptMessage {
    role: string;
    content: string;
}