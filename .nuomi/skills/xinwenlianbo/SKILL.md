---
name: xinwenlianbo
description: "获取最新新闻联播文字版内容。支持多个数据源自动切换。当用户问新闻联播、CCTV新闻、每日新闻联播文字版时使用。"
metadata:
  qwenpaw:
    emoji: "📺"
    requires:
      packages:
        - requests
        - beautifulsoup4
---

# 新闻联播文字版

获取当日（或指定日期）的新闻联播完整文字版。

## 数据源优先级

1. `mrxwlb.com` — 最稳定，首页即有文章链接
2. `0645.cn` — 按日期构造 URL，可能需要 JS 渲染
3. `cn.govopendata.com` — 按日期 `YYYYMMDD` 构造 URL

## 使用方式

```bash
# 获取最新一期
python3 skills/xinwenlianbo/xinwenlianbo.py

# 指定日期（YYYYMMDD 格式）
python3 skills/xinwenlianbo/xinwenlianbo.py --date 20260426
```

## 注意事项

- 当天新闻联播文字版需**次日才能获取**（数据源次日更新）
- 脚本输出纯文本，包含标题摘要列表 + 各条目完整正文
- 获取后存入 `knowledge/新闻联播/YYYYMMDD_新闻联播全文.txt`

## 遴选考点分析

获取新闻联播后，应同步做考点分析：
1. 每条新闻的考点方向（时政/民生/科技/生态等）
2. 可能出现的考题形式（案例分析/简答/公文写作）
3. 可引用的规范表述和金句
