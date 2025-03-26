import os
import re
import glob
import json
import io
import tkinter as tk
from tkinter import filedialog
from PIL import Image
import PyPDF2


def main():
    # 隐藏主窗口，仅显示文件对话框
    root = tk.Tk()
    root.withdraw()

    # 打开文件对话框选择第一页文件
    file_path = filedialog.askopenfilename(
        title="请选择第一页的页面文件", filetypes=[("WEBP 图片", "*.webp")]
    )
    if not file_path:
        print("未选择任何文件，程序退出。")
        return

    directory = os.path.dirname(file_path)
    filename = os.path.basename(file_path)

    # 解析文件名，提取 bookid 和页码
    m = re.match(r"^(.*)_page(\d+)\.webp$", filename)
    if not m:
        print("所选文件名格式不符合 {bookid}_page{pagenum}.webp")
        return

    bookid = m.group(1)
    start_page = int(m.group(2))
    print(f"检测到 bookid: {bookid}，起始页: {start_page}")

    # 搜索同目录下所有符合 {bookid}_page*.webp 的文件
    pattern = os.path.join(directory, f"{bookid}_page*.webp")
    files = glob.glob(pattern)

    # 从文件名中提取页码并排序
    file_info = []
    for f in files:
        base = os.path.basename(f)
        m2 = re.match(r"^(.*)_page(\d+)\.webp$", base)
        if m2 and m2.group(1) == bookid:
            page_num = int(m2.group(2))
            file_info.append((page_num, f))
    file_info.sort(key=lambda x: x[0])
    total_pages = len(file_info)

    if total_pages == 0:
        print("未找到符合条件的文件。")
        return

    print(f"共找到 {total_pages} 个页面文件，开始依次加载并合并...")

    # 按顺序读取全部图片，并转换模式
    images = []
    for idx, (page_num, filepath) in enumerate(file_info, start=1):
        try:
            img = Image.open(filepath)
            if img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            ):
                img = img.convert("RGB")
            images.append(img)
            print(f"[{idx}/{total_pages}] 已加载：{filepath}")
        except Exception as e:
            print(f"打开图片 {filepath} 失败：{e}")

    if not images:
        print("没有可用图片，程序退出。")
        return

    # 1) 在内存中将所有图片合并为 PDF
    print("\n正在生成 PDF，此步骤可能耗时较长，请耐心等待...\n")
    pdf_bytes = io.BytesIO()
    images[0].save(
        pdf_bytes,
        format="PDF",
        save_all=True,
        append_images=images[1:],
        resolution=100.0,
    )

    # 2) 利用 PyPDF2 从内存读取该 PDF，并根据 {bookid}_toc.json 创建书签
    toc_path = os.path.join(directory, f"{bookid}_toc.json")
    if not os.path.exists(toc_path):
        print(f"未找到 {toc_path}，无法添加书签。")
    else:
        with open(toc_path, "r", encoding="utf-8") as f:
            toc_data = json.load(f)

        # 重新定位到开头，把 PDF BytesIO 交给 PyPDF2
        pdf_bytes.seek(0)
        reader = PyPDF2.PdfReader(pdf_bytes)
        writer = PyPDF2.PdfWriter()

        # 将全部页面拷入 writer
        for page in reader.pages:
            writer.add_page(page)

        def add_bookmarks(toc_items, parent=None):
            for item in toc_items:
                name = item.get("name", "Untitled")
                page_str = item.get("page", "")
                children = item.get("children", [])
                if page_str.isdigit():
                    page_num = int(page_str)
                    pdf_index = page_num - start_page
                    if 0 <= pdf_index < len(writer.pages):
                        new_parent = writer.add_outline_item(name, pdf_index, parent)
                    else:
                        new_parent = None
                else:
                    new_parent = None
                if isinstance(children, list) and children:
                    add_bookmarks(children, new_parent)

        print("正在添加书签…")
        add_bookmarks(toc_data)

        # 3) 写出带书签的最终 PDF
        output_pdf = os.path.join(directory, f"{bookid}.pdf")
        with open(output_pdf, "wb") as fout:
            writer.write(fout)
        print(f"PDF 合并完成，已添加书签：{output_pdf}")
        return

    # 若未找到 toc 或读取失败，则直接将内存中的 PDF 写出，不带书签
    output_pdf = os.path.join(directory, f"{bookid}.pdf")
    pdf_bytes.seek(0)
    with open(output_pdf, "wb") as fout:
        fout.write(pdf_bytes.read())

    print(f"PDF 合并完成（无书签）：{output_pdf}")


if __name__ == "__main__":
    main()
