// ==UserScript==
// @name         文泉阅读器切片图片合并保存(增强版)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  自动合并文泉阅读器中的切片大图并保存为完整页面，支持页面选择和自动跳转
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

    // 当前处理的最小页面
    let currentMinPage = Infinity;

    // 已完成的页面集合
    const completedPages = new Set();

    // 初始化状态面板
    let statusPanel;

    // 提取书籍ID
    function getBookId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get("bid") || "unknown";
    }

    // 更新状态面板信息
    function updateStatusPanel(message) {
        if (statusPanel) {
            statusPanel.innerText = message;
        }
    }

    // 跳转到指定页面
    function jumpToPage(pageIndex) {
        const pageBox = document.querySelector(
            `.page-img-box[index="${pageIndex}"]`
        );
        if (pageBox) {
            pageBox.scrollIntoView({ behavior: "smooth", block: "start" });
            console.log(`已跳转到第${pageIndex}页`);
            updateStatusPanel(`已跳转到第${pageIndex}页`);
        }
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
        updateStatusPanel(
            `正在处理: 第${pageIndex}页, 位置${leftValue}, 当前该页切片数: ${pageSlices[pageIndex].size}`
        );
        console.log(
            `已记录切片: 页${pageIndex}, 位置${leftValue}, 当前该页切片数: ${pageSlices[pageIndex].size}`
        );

        // 更新当前最小页面
        if (
            parseInt(pageIndex) < currentMinPage &&
            !completedPages.has(pageIndex)
        ) {
            currentMinPage = parseInt(pageIndex);
            jumpToPage(currentMinPage);
        }

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
            updateStatusPanel(`所有切片已加载，开始合并第${pageIndex}页...`);
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

                        // 标记该页已处理完成
                        completedPages.add(pageIndex);

                        // 通知
                        GM_notification({
                            title: "页面合并完成",
                            text: `第${pageIndex}页已合并保存为 ${filename}`,
                            timeout: 3000,
                        });

                        updateStatusPanel(
                            `第${pageIndex}页处理完成！已保存为 ${filename}`
                        );

                        // 找到下一个未完成的最小页面
                        findAndJumpToNextPage();
                    }, 100);
                },
                "image/webp",
                0.95
            );
        } catch (error) {
            console.error(`合并页${pageIndex}失败:`, error);
        }
    }

    // 找到下一个未完成的最小页面并跳转
    function findAndJumpToNextPage() {
        const allPageIndices = Object.keys(pageSlices)
            .map((idx) => parseInt(idx))
            .sort((a, b) => a - b);

        // 找到下一个未完成的最小页面
        let nextPage = null;
        for (let i = 0; i < allPageIndices.length; i++) {
            if (!completedPages.has(allPageIndices[i].toString())) {
                nextPage = allPageIndices[i];
                break;
            }
        }

        if (nextPage !== null) {
            currentMinPage = nextPage;
            jumpToPage(nextPage);
            updateStatusPanel(`跳转到下一个待处理页面: 第${nextPage}页`);
        } else {
            updateStatusPanel("所有页面处理完成！");
            GM_notification({
                title: "处理完成",
                text: "所有页面都已合并保存！",
                timeout: 5000,
            });
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
        panel.style.width = "250px";
        panel.style.fontFamily = "Arial, sans-serif";
        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:10px;font-size:14px;border-bottom:1px solid #ccc;padding-bottom:5px;">文泉切片合并工具</div>
            <div style="margin-bottom:10px;">
                <button id="checkAndMergeAll" style="margin-right:5px;padding:3px 8px;">合并所有页面</button>
                <button id="goToPage" style="padding:3px 8px;">跳转到页面</button>
            </div>
            <div id="statusDisplay" style="font-size:12px;margin-top:10px;min-height:40px;border-top:1px solid #555;padding-top:5px;">
                等待操作...
            </div>
        `;

        document.body.appendChild(panel);

        // 保存状态显示区域的引用
        statusPanel = document.getElementById("statusDisplay");

        document
            .getElementById("checkAndMergeAll")
            .addEventListener("click", () => {
                const bookId = getBookId();
                // 合并所有已记录的页面
                Object.keys(pageSlices).forEach((pageIndex) => {
                    checkAndMergePage(bookId, pageIndex);
                });
            });

        document.getElementById("goToPage").addEventListener("click", () => {
            const page = prompt("请输入要跳转的页码：");
            if (page && !isNaN(parseInt(page))) {
                jumpToPage(parseInt(page));
            }
        });
    }

    // 初始化脚本，询问起始页面
    function initScript() {
        const startPage = prompt(
            "请输入要开始处理的页码 (按取消则从当前页开始)："
        );
        if (startPage && !isNaN(parseInt(startPage))) {
            currentMinPage = parseInt(startPage);
            jumpToPage(currentMinPage);
        } else {
            // 从显示的第一页开始
            const firstVisiblePage = document.querySelector(".page-img-box");
            if (firstVisiblePage) {
                currentMinPage = parseInt(
                    firstVisiblePage.getAttribute("index")
                );
            }
        }

        console.log(`开始处理，起始页为：${currentMinPage}`);
        updateStatusPanel(`开始处理，起始页为：第${currentMinPage}页`);

        processExistingImages();
        setupObserver();
    }

    // 页面加载完成后执行
    window.addEventListener("load", function () {
        console.log("页面已加载，添加控制面板");
        addControlPanel();

        // 延迟执行初始化，等待页面完全加载
        setTimeout(initScript, 1000);
    });

    // 尝试立即添加控制面板
    setTimeout(addControlPanel, 500);
})();
