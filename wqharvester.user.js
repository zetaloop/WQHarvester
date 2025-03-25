// ==UserScript==
// @name         文泉阅读器切片图片合并保存
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  自动合并文泉阅读器中的切片大图并保存为完整页面
// @author       You
// @match        https://wqbook.wqxuetang.com/deep/read/*
// @match        *://wqbook.wqxuetang.com/deep/read/*
// @grant        GM_notification
// ==/UserScript==

(function () {
    "use strict";

    console.log("文泉切片图片合并保存脚本已加载");

    // 跟踪每页的切片加载情况
    const pageSlices = {};

    // 提取书籍ID
    function getBookId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get("bid") || "unknown";
    }

    // 处理并记录切片图片
    function processSliceImage(imgElement, bookId, pageIndex, leftValue) {
        const sliceKey = `${bookId}_${pageIndex}_${leftValue}`;

        // 初始化该页的切片集合
        if (!pageSlices[pageIndex]) {
            pageSlices[pageIndex] = new Map();
        }

        // 如果此切片已处理过，则跳过
        if (pageSlices[pageIndex].has(leftValue)) {
            return;
        }

        // 记录该切片
        pageSlices[pageIndex].set(leftValue, imgElement);
        console.log(
            `已记录切片: 页${pageIndex}, 位置${leftValue}, 当前该页切片数: ${pageSlices[pageIndex].size}`
        );

        // 检查是否所有切片都已加载 (通常是6个)
        checkAndMergePage(bookId, pageIndex);
    }

    // 检查页面切片是否完整并合并
    function checkAndMergePage(bookId, pageIndex) {
        const pageBox = document.querySelector(
            `.page-img-box[index="${pageIndex}"]`
        );
        if (!pageBox) return;

        const plgContainer = pageBox.querySelector(".plg");
        if (!plgContainer) return;

        // 获取该页面应有的切片总数
        const totalSlices = plgContainer.querySelectorAll("img").length;
        const currentSlices = pageSlices[pageIndex]
            ? pageSlices[pageIndex].size
            : 0;

        console.log(`页${pageIndex} 切片状态: ${currentSlices}/${totalSlices}`);

        // 如果所有切片都已加载，合并为一张完整图片
        if (currentSlices >= totalSlices && totalSlices > 0) {
            console.log(`所有切片已加载，开始合并页${pageIndex}的切片...`);
            mergeAndSavePage(bookId, pageIndex);
        }
    }

    // 合并切片并保存为完整页面
    function mergeAndSavePage(bookId, pageIndex) {
        if (!pageSlices[pageIndex] || pageSlices[pageIndex].size === 0) {
            console.log(`页${pageIndex}没有可合并的切片`);
            return;
        }

        try {
            // 将切片按从左到右排序
            const sortedSlices = Array.from(
                pageSlices[pageIndex].entries()
            ).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

            // 计算合并后图片的总宽度和高度
            let totalWidth = 0;
            let maxHeight = 0;

            sortedSlices.forEach(([left, img]) => {
                totalWidth += img.naturalWidth;
                maxHeight = Math.max(maxHeight, img.naturalHeight);
            });

            // 创建画布
            const canvas = document.createElement("canvas");
            canvas.width = totalWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext("2d");

            // 在画布上从左到右绘制切片
            let currentX = 0;
            sortedSlices.forEach(([left, img]) => {
                ctx.drawImage(img, currentX, 0);
                currentX += img.naturalWidth;
            });

            // 保存合并后的图片
            const filename = `${bookId}_page${pageIndex}_complete.webp`;

            canvas.toBlob(
                function (blob) {
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    link.style.display = "none";

                    document.body.appendChild(link);
                    link.click();

                    setTimeout(() => {
                        URL.revokeObjectURL(link.href);
                        document.body.removeChild(link);
                        console.log(`已保存合并页面: ${filename}`);
                        GM_notification({
                            title: "页面已合并保存",
                            text: filename,
                            timeout: 3000,
                        });
                    }, 100);
                },
                "image/webp",
                0.95
            );

            // 标记该页已处理完成
            console.log(`页${pageIndex}处理完成`);
        } catch (error) {
            console.error(`合并页${pageIndex}失败:`, error);
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
                    const leftValue = parseFloat(img.style.left) || 0;
                    processSliceImage(img, bookId, pageIndex, leftValue);
                } else {
                    // 图片尚未加载完成，添加加载事件
                    img.addEventListener("load", function () {
                        const leftValue = parseFloat(img.style.left) || 0;
                        processSliceImage(img, bookId, pageIndex, leftValue);
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

                                if (node.complete && node.naturalHeight !== 0) {
                                    const leftValue =
                                        parseFloat(node.style.left) || 0;
                                    processSliceImage(
                                        node,
                                        bookId,
                                        pageIndex,
                                        leftValue
                                    );
                                } else {
                                    node.addEventListener("load", function () {
                                        const leftValue =
                                            parseFloat(node.style.left) || 0;
                                        processSliceImage(
                                            node,
                                            bookId,
                                            pageIndex,
                                            leftValue
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
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "style"],
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
            <div>文泉切片合并工具</div>
            <button id="checkAndMergeAll">合并所有已加载页面</button>
            <button id="refreshCurrentPage">刷新当前页检测</button>
        `;

        document.body.appendChild(panel);

        document
            .getElementById("checkAndMergeAll")
            .addEventListener("click", () => {
                const bookId = getBookId();
                // 合并所有已记录的页面
                Object.keys(pageSlices).forEach((pageIndex) => {
                    checkAndMergePage(bookId, pageIndex);
                });
            });

        document
            .getElementById("refreshCurrentPage")
            .addEventListener("click", processExistingImages);
    }

    // 页面加载完成后执行
    window.addEventListener("load", function () {
        console.log("页面已加载，开始处理图片");
        processExistingImages();
        setupObserver();
        addControlPanel();
    });

    // 也尝试立即执行一次，处理可能已经加载的图片
    setTimeout(() => {
        processExistingImages();
        setupObserver();
        addControlPanel();
    }, 1500);
})();
