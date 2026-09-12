#!/usr/bin/env python3
"""
Quét toàn bộ file .md trong content/posts/ và gộp thành 1 file duy nhất
content/posts-index.json — giúp trang web chỉ cần gọi 1 request để lấy
danh sách đầy đủ bài viết, thay vì phải gọi riêng từng file (chậm hơn
rất nhiều khi số bài viết tăng lên). File này được GitHub Actions tự
động chạy lại mỗi khi có thay đổi trong content/posts/.
"""
import os
import re
import json

POSTS_DIR = "content/posts"
OUTPUT_FILE = "content/posts-index.json"


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


if __name__ == "__main__":
    main()
