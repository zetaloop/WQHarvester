import os
import re
import glob
import tkinter as tk
from tkinter import filedialog
from PIL import Image

def main():
    # 隐藏主窗口，仅显示文件对话框
    root = tk.Tk()
    root.withdraw()

    # 打开文件对话框选择第一页文件
    file_path = filedialog.askopenfilename(
        title="请选择第一页的页面文件",
        filetypes=[("WEBP 图片", "*.webp")]
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

    # 构建同一目录下符合该 bookid 的文件列表
    pattern = os.path.join(directory, f"{bookid}_page*.webp")
    files = glob.glob(pattern)
    file_info = []
    for f in files:
        base = os.path.basename(f)
        m2 = re.match(r"^(.*)_page(\d+)\.webp$", base)
        if m2 and m2.group(1) == bookid:
            page_num = int(m2.group(2))
            file_info.append((page_num, f))
    if not file_info:
        print("未找到符合条件的文件。")
        return

    # 按页码排序
    file_info.sort(key=lambda x: x[0])
    print(f"共找到 {len(file_info)} 个页面文件，正在加载图片...")

    # 打开所有图片，并转换为 RGB（PDF 不支持透明通道）
    images = []
    for page, f in file_info:
        try:
            img = Image.open(f)
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGB")
            images.append(img)
            print(f"加载成功：{f}")
        except Exception as e:
            print(f"打开图片 {f} 失败: {e}")

    if not images:
        print("没有图片可以合并，程序退出。")
        return

    # 保存为 PDF，文件名为 {bookid}.pdf，第一页图片作为基础，其余图片作为附加页
    output_pdf = os.path.join(directory, f"{bookid}.pdf")
    try:
        images[0].save(output_pdf, "PDF", resolution=100.0, save_all=True, append_images=images[1:])
        print(f"PDF 合并完成：{output_pdf}")
    except Exception as e:
        print(f"保存 PDF 失败：{e}")

if __name__ == "__main__":
    main()
