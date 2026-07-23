#!/usr/bin/env python3
"""
新闻联播文字版抓取脚本
按优先级依次尝试三个数据源，获取最新一期的完整文字版内容。

用法:
  python3 xinwenlianbo.py              # 获取最新一期
  python3 xinwenlianbo.py --date 20260426  # 指定日期
"""

import argparse
import functools
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

print = functools.partial(print, flush=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
TIMEOUT = (5, 10)  # (connect, read)


# ─── 数据源 1: mrxwlb.com ───────────────────────────────────────────

def fetch_mrxwlb(target_date=None):
    """从 mrxwlb.com 获取最新新闻联播文字版"""
    base = "http://mrxwlb.com"
    print("📡 尝试数据源: mrxwlb.com ...")

    resp = requests.get(base, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    # 找到文章链接（格式 /2026/04/26/...）
    article_link = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.search(r"mrxwlb\.com/\d{4}/\d{2}/\d{2}/", href) or re.match(r"/\d{4}/\d{2}/\d{2}/", href):
            if target_date:
                # 检查日期匹配
                d = re.search(r"(\d{4})/(\d{2})/(\d{2})", href)
                if d and f"{d.group(1)}{d.group(2)}{d.group(3)}" != target_date:
                    continue
            article_link = urljoin(base, href)
            break

    if not article_link:
        raise RuntimeError("mrxwlb.com: 未找到文章链接" + (f" (日期: {target_date})" if target_date else ""))

    print(f"  📄 文章页: {article_link}")
    resp2 = requests.get(article_link, headers=HEADERS, timeout=TIMEOUT)
    resp2.raise_for_status()
    resp2.encoding = resp2.apparent_encoding or "utf-8"
    soup2 = BeautifulSoup(resp2.text, "html.parser")

    content_div = soup2.find("div", class_="entry-content") or soup2.find("article") or soup2.find("div", class_="post-content")
    if not content_div:
        content_div = soup2

    paragraphs = []
    for el in content_div.find_all(["p", "li", "h2", "h3"]):
        text = el.get_text(strip=True)
        if text and len(text) > 2:
            if el.name in ("h2", "h3"):
                paragraphs.append(f"\n## {text}")
            elif el.name == "li":
                paragraphs.append(f"• {text}")
            else:
                paragraphs.append(text)

    if len(paragraphs) < 3:
        raise RuntimeError("mrxwlb.com: 正文内容太少")

    title_tag = soup2.find("title")
    date_match = re.search(r"(\d{4})年(\d{2})月(\d{2})日", title_tag.text if title_tag else "")
    date_str = date_match.group(0) if date_match else "未知日期"

    return {
        "source": "mrxwlb.com",
        "date": date_str,
        "url": article_link,
        "content": "\n".join(paragraphs),
    }


# ─── 数据源 2: 0645.cn ──────────────────────────────────────────────

def fetch_0645(target_date=None):
    """从 0645.cn 获取最新新闻联播文字版"""
    print("📡 尝试数据源: 0645.cn ...")

    today = datetime.now()
    dates_to_try = []
    if target_date:
        dt = datetime.strptime(target_date, "%Y%m%d")
        dates_to_try.append(dt)
    else:
        for delta in range(0, 3):
            dates_to_try.append(today - timedelta(days=delta))

    for dt in dates_to_try:
        date_slug = dt.strftime("%Y-%m-%d")
        date_cn = dt.strftime("%Y年%m月%d日").replace("年0", "年").replace("月0", "月")
        urls_to_try = [
            f"https://www.0645.cn/{date_slug}",
            f"https://www.0645.cn/news/{date_slug}",
        ]
        for url in urls_to_try:
            try:
                resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
                if resp.status_code != 200:
                    continue
                resp.encoding = resp.apparent_encoding or "utf-8"
                soup = BeautifulSoup(resp.text, "html.parser")
                text = soup.get_text()
                if "新闻联播" not in text and len(text) < 500:
                    continue
                paragraphs = []
                for el in soup.find_all(["p", "li"]):
                    t = el.get_text(strip=True)
                    if t and len(t) > 5:
                        paragraphs.append(t)
                if len(paragraphs) >= 5:
                    return {
                        "source": "0645.cn",
                        "date": date_cn,
                        "url": url,
                        "content": "\n".join(paragraphs),
                    }
            except Exception:
                continue

    raise RuntimeError("0645.cn: 未找到可用文章")


# ─── 数据源 3: govopendata.com ──────────────────────────────────────

def fetch_govopendata(target_date=None):
    """从 cn.govopendata.com 获取最新新闻联播文字版"""
    print("📡 尝试数据源: cn.govopendata.com ...")

    base = "https://cn.govopendata.com/xinwenlianbo/"

    # 如果指定了日期，直接构造 URL
    if target_date:
        try_url = f"https://cn.govopendata.com/xinwenlianbo/{target_date}/"
        try:
            r = requests.get(try_url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
            if r.status_code == 200 and len(r.text) > 500:
                return _parse_govopendata(try_url, r)
        except Exception:
            pass
        raise RuntimeError(f"govopendata.com: 未找到 {target_date} 的文章")

    # 否则先从首页找链接
    resp = requests.get(base, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    article_link = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/xinwenlianbo/" in href and re.search(r"\d{8}", href):
            article_link = urljoin(base, href)
            break

    if not article_link:
        # 尝试近几天的日期 URL
        today = datetime.now()
        for delta in range(0, 3):
            dt = today - timedelta(days=delta)
            date_num = dt.strftime("%Y%m%d")
            try_url = f"https://cn.govopendata.com/xinwenlianbo/{date_num}/"
            try:
                r = requests.get(try_url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
                if r.status_code == 200 and len(r.text) > 500:
                    article_link = try_url
                    break
            except Exception:
                continue

    if not article_link:
        raise RuntimeError("govopendata.com: 未找到文章链接")

    print(f"  📄 文章页: {article_link}")
    resp2 = requests.get(article_link, headers=HEADERS, timeout=TIMEOUT)
    resp2.raise_for_status()
    return _parse_govopendata(article_link, resp2)


def _parse_govopendata(url, resp):
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")

    paragraphs = []
    for el in soup.find_all(["p", "li", "h2", "h3"]):
        text = el.get_text(strip=True)
        if text and len(text) > 3:
            if el.name in ("h2", "h3"):
                paragraphs.append(f"\n## {text}")
            elif el.name == "li":
                paragraphs.append(f"• {text}")
            else:
                paragraphs.append(text)

    if len(paragraphs) < 3:
        raise RuntimeError("govopendata.com: 正文内容太少")

    date_match = re.search(r"(\d{4})(\d{2})(\d{2})", url)
    date_str = f"{date_match.group(1)}年{date_match.group(2)}月{date_match.group(3)}日" if date_match else "未知日期"

    return {
        "source": "cn.govopendata.com",
        "date": date_str,
        "url": url,
        "content": "\n".join(paragraphs),
    }


# ─── 主逻辑 ─────────────────────────────────────────────────────────

FETCHERS = [
    ("mrxwlb.com",         fetch_mrxwlb),
    ("0645.cn",            fetch_0645),
    ("cn.govopendata.com", fetch_govopendata),
]


def main():
    parser = argparse.ArgumentParser(description="获取新闻联播文字版")
    parser.add_argument("--date", type=str, default=None,
                        help="指定日期，YYYYMMDD 格式，如 20260426")
    args = parser.parse_args()

    print("=" * 60)
    print("📺 新闻联播文字版抓取")
    if args.date:
        print(f"📅 目标日期: {args.date}")
    print("=" * 60)

    for name, fetcher in FETCHERS:
        try:
            result = fetcher(target_date=args.date)
            print(f"\n✅ 成功！数据源: {result['source']}")
            print(f"📅 日期: {result['date']}")
            print(f"🔗 来源: {result['url']}")
            print("-" * 60)
            print(result["content"])
            print("-" * 60)
            return 0
        except Exception as e:
            print(f"  ❌ {name} 失败: {e}")
            continue

    print("\n⛔ 所有数据源均不可用，请稍后重试。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
