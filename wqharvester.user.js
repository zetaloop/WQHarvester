// ==UserScript==
// @name         文泉阅读器切片图片保存(改进版)
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  自动保存文泉阅读器中的切片大图(支持一次性URL)
// @author       You
// @match        https://wqbook.wqxuetang.com/deep/read/*
// @match        *://wqbook.wqxuetang.com/deep/read/*
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    "use strict";

    console.log("文泉切片图片保存脚本已加载");

    // 提取书籍ID
    function getBookId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get("bid") || "unknown";
    }

    // 已处理的图片URLs集合，避免重复下载
    const processedImages = new Set();

    // 通过Canvas下载图片
    function downloadImageViaCanvas(imgElement, bookId, pageIndex, sliceIndex) {
        const imgUrl = imgElement.src;

        // 如果已经处理过这个URL，则跳过
        if (processedImages.has(imgUrl)) {
            return;
        }

        const filename = `${bookId}_${pageIndex}_${sliceIndex}.webp`;
        console.log(`正在处理: ${filename}`);

        try {
            // 创建canvas元素
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            // 设置canvas尺寸与图片一致
            canvas.width = imgElement.naturalWidth;
            canvas.height = imgElement.naturalHeight;

            // 在canvas上绘制图片
            ctx.drawImage(imgElement, 0, 0);

            // 转换为blob并下载
            canvas.toBlob(
                function (blob) {
                    // 创建下载链接
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    link.style.display = "none";

                    // 添加到文档并触发下载
                    document.body.appendChild(link);
                    link.click();

                    // 清理
                    setTimeout(() => {
                        URL.revokeObjectURL(link.href);
                        document.body.removeChild(link);
                        console.log(`已保存: ${filename}`);
                        GM_notification({
                            title: "图片已保存",
                            text: filename,
                            timeout: 2000,
                        });
                    }, 100);
                },
                "image/webp",
                0.95
            );

            // 标记为已处理
            processedImages.add(imgUrl);
        } catch (error) {
            console.error(`处理失败: ${filename}`, error);
        }
    }

    // 处理页面中现有的图片
    function processExistingImages() {
        const bookId = getBookId();
        console.log(`检测到书籍ID: ${bookId}`);

        document.querySelectorAll(".page-img-box").forEach((pageBox) => {
            const pageIndex = pageBox.getAttribute("index");
            const plgContainer = pageBox.querySelector(".plg");

            if (!plgContainer) return;

            // 获取所有已加载的切片图片
            const sliceImages = plgContainer.querySelectorAll("img");

            sliceImages.forEach((img) => {
                if (img.complete && img.naturalHeight !== 0) {
                    // 提取left值作为sliceIndex
                    const leftValue = parseInt(img.style.left) || 0;
                    downloadImageViaCanvas(img, bookId, pageIndex, leftValue);
                } else {
                    // 图片尚未加载完成，添加加载事件
                    img.addEventListener("load", function () {
                        const leftValue = parseInt(img.style.left) || 0;
                        downloadImageViaCanvas(
                            img,
                            bookId,
                            pageIndex,
                            leftValue
                        );
                    });
                }
            });
        });
    }

    // 设置DOM观察器监视新添加的图片
    function setupObserver() {
        const bookId = getBookId();

        // 创建MutationObserver观察DOM变化
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                // 检查是否有新添加的节点
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach((node) => {
                        // 检查是否是需要处理的img元素
                        if (
                            node.nodeName === "IMG" &&
                            node.parentElement &&
                            node.parentElement.classList.contains("plg")
                        ) {
                            const pageBox = node.closest(".page-img-box");
                            if (pageBox) {
                                const pageIndex = pageBox.getAttribute("index");
                                const leftValue =
                                    parseInt(node.style.left) || 0;

                                if (node.complete && node.naturalHeight !== 0) {
                                    downloadImageViaCanvas(
                                        node,
                                        bookId,
                                        pageIndex,
                                        leftValue
                                    );
                                } else {
                                    node.addEventListener("load", function () {
                                        const currentLeftValue =
                                            parseInt(node.style.left) || 0;
                                        downloadImageViaCanvas(
                                            node,
                                            bookId,
                                            pageIndex,
                                            currentLeftValue
                                        );
                                    });
                                }
                            }
                        }
                    });
                }
            });
        });

        // 配置观察器选项
        const config = {
            childList: true, // 观察子节点的添加或删除
            subtree: true, // 观察整个子树
            attributes: true, // 观察属性变化
            attributeFilter: ["src", "style"], // 仅观察特定属性
        };

        // 开始观察整个document
        observer.observe(document.body, config);
    }

    // 添加控制面板
    function addControlPanel() {
        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "10px";
        panel.style.right = "10px";
        panel.style.backgroundColor = "rgba(0,0,0,0.7)";
        panel.style.color = "white";
        panel.style.padding = "10px";
        panel.style.borderRadius = "5px";
        panel.style.zIndex = "9999";
        panel.innerHTML = `
            <div>文泉切片保存工具</div>
            <button id="saveCurrentPage">保存当前页</button>
            <button id="saveAllPages">保存所有页</button>
        `;

        document.body.appendChild(panel);

        document
            .getElementById("saveCurrentPage")
            .addEventListener("click", processExistingImages);
        document
            .getElementById("saveAllPages")
            .addEventListener("click", () => {
                // 触发所有页面的保存
                document
                    .querySelectorAll(".page-img-box")
                    .forEach((pageBox) => {
                        const pageIndex = pageBox.getAttribute("index");
                        console.log(`处理页面 ${pageIndex}...`);
                        const plgContainer = pageBox.querySelector(".plg");

                        if (!plgContainer) return;

                        // 获取所有已加载的切片图片
                        const sliceImages =
                            plgContainer.querySelectorAll("img");

                        sliceImages.forEach((img) => {
                            if (img.complete && img.naturalHeight !== 0) {
                                const leftValue = parseInt(img.style.left) || 0;
                                downloadImageViaCanvas(
                                    img,
                                    getBookId(),
                                    pageIndex,
                                    leftValue
                                );
                            }
                        });
                    });
            });
    }

    // 页面加载完成后执行
    window.addEventListener("load", function () {
        console.log("页面已加载，开始处理图片");
        addControlPanel();
        setupObserver();
    });

    // 也尝试立即执行一次，处理可能已经加载的图片
    setTimeout(() => {
        setupObserver();
        addControlPanel();
    }, 1500);
})();
