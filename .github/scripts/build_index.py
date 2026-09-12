#!/usr/bin/env python3
"""
Quét toàn bộ file .md trong content/posts/ và:
1. Gộp thành file content/posts-index.json (danh sách bài viết, giúp trang tải nhanh).
2. Tự động sinh file sitemap.xml ở gốc repo, liệt kê mọi trang tĩnh + mọi bài viết,
   giúp Google tìm và lập chỉ mục đầy đủ, nhanh hơn.
File này được GitHub Actions tự động chạy lại mỗi khi có thay đổi trong content/posts/.
"""
import os
import re
import json
from datetime import date

POSTS_DIR = "content/posts"
OUTPUT_FILE = "content/posts-index.json"
SITE_URL = "https://wvn.vn"
SITEMAP_FILE = "sitemap.xml"

# Các trang tĩnh cố định của website (không phải bài viết động)
STATIC_PAGES = [
    ("/", "weekly"),
    ("/su-menh.html", "monthly"),
    ("/hoat-dong.html", "weekly"),
    ("/sao-ke.html", "weekly"),
    ("/tin-tuc.html", "daily"),
    ("/lien-he.html", "monthly"),
    ("/chinh-sach-bao-mat.html", "yearly"),
]


def parse_front_matter(raw):
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', raw, re.S)
    if not match:
        return None
    yaml_block, body = match.group(1), match.group(2)
    data = {"title": "", "date": "", "image": "", "excerpt": "", "loai": ""}
    for line in yaml_block.splitlines():
        m = re.match(r'^([a-zA-Z0-9_]+)\s*:\s*(.*)$', line)
        if not m:
            continue
        key = m.group(1).strip().lower()
        value = m.group(2).strip()
        value = value.strip('"\'')
        if key == "description":
            data["excerpt"] = data["excerpt"] or value
        elif key == "thumbnail":
            data["image"] = data["image"] or value
        elif key in data:
            data[key] = value
    data["body"] = body
    return data


def first_paragraph(body):
    clean = re.sub(r'^#.*$', '', body, flags=re.M)
    clean = re.sub(r'!\[.*?\]\(.*?\)', '', clean)
    clean = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', clean)
    clean = re.sub(r'[*_`>]', '', clean).strip()
    paras = [p.strip() for p in re.split(r'\n\s*\n', clean) if p.strip()]
    return paras[0][:160] if paras else ""


def slug_to_title(slug):
    return " ".join(w.capitalize() for w in slug.replace("-", " ").split())


def generate_sitemap(posts):
    """Sinh nội dung file sitemap.xml từ danh sách trang tĩnh + toàn bộ bài viết."""
    today = date.today().isoformat()
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']

    for path, freq in STATIC_PAGES:
        lines.append("  <url>")
        lines.append(f"    <loc>{SITE_URL}{path}</loc>")
        lines.append(f"    <lastmod>{today}</lastmod>")
        lines.append(f"    <changefreq>{freq}</changefreq>")
        lines.append("  </url>")

    for post in posts:
        # Trang chi tiết bài viết dùng slug làm tham số: chi-tiet.html?slug=...
        lines.append("  <url>")
        lines.append(f"    <loc>{SITE_URL}/chi-tiet.html?slug={post['slug']}</loc>")
        lines.append("    <changefreq>monthly</changefreq>")
        lines.append("  </url>")

    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    posts = []
    if os.path.isdir(POSTS_DIR):
        for fname in sorted(os.listdir(POSTS_DIR)):
            if not fname.lower().endswith(".md"):
                continue
            slug = fname[:-3]
            path = os.path.join(POSTS_DIR, fname)
            try:
                with open(path, encoding="utf-8") as f:
                    raw = f.read()
            except Exception as e:
                print(f"Bỏ qua {fname}: không đọc được file ({e})")
                continue

            fm = parse_front_matter(raw)
            if not fm:
                print(f"Bỏ qua {fname}: thiếu front matter hợp lệ")
                continue

            posts.append({
                "slug": slug,
                "title": fm["title"] or slug_to_title(slug),
                "date": fm["date"],
                "image": fm["image"],
                "loai": fm["loai"],
                "excerpt": fm["excerpt"] or first_paragraph(fm["body"]) or "Bấm để đọc toàn bộ nội dung bài viết."
            })

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)

    print(f"Đã tạo {OUTPUT_FILE} với {len(posts)} bài viết.")

    sitemap_content = generate_sitemap(posts)
    with open(SITEMAP_FILE, "w", encoding="utf-8") as f:
        f.write(sitemap_content)

    print(f"Đã tạo {SITEMAP_FILE} với {len(STATIC_PAGES) + len(posts)} đường dẫn.")


if __name__ == "__main__":
    main()
