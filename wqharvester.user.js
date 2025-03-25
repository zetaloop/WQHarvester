// ==UserScript==
// @name         文泉阅读器切片图片合并保存(高级交互版)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动合并文泉阅读器中的切片大图并保存为完整页面，支持页面选择和高级交互界面
// @author       You
// @match        https://wqbook.wqxuetang.com/deep/read/*
// @match        *://wqbook.wqxuetang.com/deep/read/*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    console.log("文泉切片图片合并保存脚本已加载");

    // 跟踪每页的切片加载情况
    const pageSlices = {};

    // 当前处理的最小页面
    let currentMinPage = Infinity;

    // 起始页面
    let startPage = 1;

    // 已完成的页面集合
    const completedPages = new Set();

    // 待合并的页面集合 (切片已加载完成但尚未合并)
    const pendingPages = new Set();

    // 处理中的页面集合
    const processingPages = new Set();

    // 当前活动页面 (用于控制只合并当前页)
    let activePage = null;

    // 是否正在运行
    let isRunning = false;

    // 脚本是否已初始化
    let isInitialized = false;

    // 是否有面板已创建
    let panelCreated = false;

    // 观察器引用
    let observer = null;

    // 面板引用
    let mainPanel;
    let statusDisplay;
    let progressDisplay;
    let currentPageInfo;
    let completionNotice;

    // 消息定时器
    let noticeTimer = null;

    // 提取书籍ID
    function getBookId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get("bid") || "unknown";
    }

    // 显示临时通知消息
    function showNotice(message, duration = 3000) {
        if (!completionNotice) return;

        // 清除之前的定时器
        if (noticeTimer) {
            clearTimeout(noticeTimer);
        }

        // 显示新消息
        completionNotice.textContent = message;
        completionNotice.style.opacity = "1";

        // 设置消失定时器
        noticeTimer = setTimeout(() => {
            completionNotice.style.opacity = "0";
        }, duration);
    }

    // 更新状态面板信息
    function updateStatusDisplay(message) {
        if (statusDisplay) {
            statusDisplay.textContent = message;
        }
    }

    // 更新当前页面信息
    function updateCurrentPageInfo(message) {
        if (currentPageInfo) {
            currentPageInfo.innerHTML = message;
        }
    }

    // 更新进度条显示
    function updateProgressBar(pageIndex, slices) {
        if (!progressDisplay) return;

        // 清空当前进度条
        progressDisplay.innerHTML = "";

        // 如果没有切片，显示空进度条
        if (!slices || slices.size === 0) {
            progressDisplay.innerHTML = `
                <div class="progress-container">
                    <div class="progress-item"></div>
                    <div class="progress-item"></div>
                    <div class="progress-item"></div>
                    <div class="progress-item"></div>
                    <div class="progress-item"></div>
                    <div class="progress-item"></div>
                </div>
            `;
            return;
        }

        // 按left值排序切片
        const sortedSlices = Array.from(slices.keys())
            .map((key) => parseFloat(key))
            .sort((a, b) => a - b);

        // 确定6个位置区间
        const minLeft = sortedSlices[0];
        const maxLeft = sortedSlices[sortedSlices.length - 1];
        const range = maxLeft - minLeft;
        const interval = range / 5; // 分成6段

        // 创建进度条容器
        const container = document.createElement("div");
        container.className = "progress-container";

        // 为每个位置创建进度块
        for (let i = 0; i < 6; i++) {
            const lowerBound =
                i === 0 ? minLeft - 0.1 : minLeft + interval * (i - 0.01);
            const upperBound =
                i === 5 ? maxLeft + 0.1 : minLeft + interval * (i + 1.01);

            const progressItem = document.createElement("div");
            progressItem.className = "progress-item";

            // 检查此区间是否有切片
            const hasSlice = sortedSlices.some(
                (left) => left >= lowerBound && left <= upperBound
            );

            if (hasSlice) {
                progressItem.classList.add("loaded");
            }

            container.appendChild(progressItem);
        }

        progressDisplay.appendChild(container);
    }

    // 获取当前可见的页面索引
    function getCurrentVisiblePage() {
        // 获取所有页面元素
        const pageElements = document.querySelectorAll(".page-img-box");
        if (!pageElements || pageElements.length === 0) return null;

        // 获取窗口高度和滚动位置
        const windowHeight = window.innerHeight;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollBottom = scrollTop + windowHeight;

        // 查找当前在视口中的页面
        let bestVisiblePage = null;
        let bestVisibility = 0;

        pageElements.forEach((page) => {
            const rect = page.getBoundingClientRect();
            const pageTop = rect.top + scrollTop;
            const pageBottom = rect.bottom + scrollTop;

            // 计算页面在视口中可见的部分
            const visibleTop = Math.max(pageTop, scrollTop);
            const visibleBottom = Math.min(pageBottom, scrollBottom);
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);

            // 如果这个页面比之前找到的更可见，则更新
            if (visibleHeight > bestVisibility) {
                bestVisibility = visibleHeight;
                bestVisiblePage = parseInt(page.getAttribute("index"));
            }
        });

        return bestVisiblePage;
    }

    // 跳转到指定页面，带验证和重试
    function jumpToPage(pageIndex, isRetry = false) {
        const pageBox = document.querySelector(
            `.page-img-box[index="${pageIndex}"]`
        );
        if (!pageBox) {
            console.log(`找不到第${pageIndex}页元素`);
            updateStatusDisplay(`找不到第${pageIndex}页元素`);
            return;
        }

        pageBox.scrollIntoView({ behavior: "smooth", block: "start" });
        console.log(`正在跳转到第${pageIndex}页${isRetry ? "(重试)" : ""}`);
        updateStatusDisplay(`正在跳转到第${pageIndex}页...`);

        // 1秒后验证跳转是否成功
        setTimeout(() => {
            const currentPage = getCurrentVisiblePage();
            console.log(`跳转后检测: 目标=${pageIndex}, 当前=${currentPage}`);

            // 如果当前页与目标页相差超过2页且未重试过，则再次尝试跳转
            if (
                currentPage !== null &&
                Math.abs(currentPage - pageIndex) > 2 &&
                !isRetry
            ) {
                console.log(`跳转偏差过大，再次尝试跳转到第${pageIndex}页`);
                jumpToPage(pageIndex, true); // 重试一次
            } else {
                updateStatusDisplay(`已定位到第${pageIndex}页附近`);

                // 更新活动页面
                activePage = pageIndex;

                // 如果该页面在待合并集合中，立即合并它
                if (pendingPages.has(pageIndex.toString()) && isRunning) {
                    const bookId = getBookId();
                    mergeAndSavePage(bookId, pageIndex.toString());
                }

                // 更新页面信息和进度条
                if (pageSlices[pageIndex]) {
                    updateProgressBar(pageIndex, pageSlices[pageIndex]);
                    updateCurrentPageInfo(
                        `当前页面: <b>第${pageIndex}页</b> (已加载 ${pageSlices[pageIndex].size} 个切片)`
                    );
                } else {
                    updateProgressBar(pageIndex, null);
                    updateCurrentPageInfo(
                        `当前页面: <b>第${pageIndex}页</b> (尚未加载切片)`
                    );
                }
            }
        }, 1000);
    }

    // 处理并记录切片图片
    function processSliceImage(imgElement, bookId, pageIndex, leftValue) {
        // 如果已停止或页面小于起始页，直接跳过
        if (!isRunning || parseInt(pageIndex) < startPage) {
            return;
        }

        // 初始化该页的切片集合
        if (!pageSlices[pageIndex]) {
            pageSlices[pageIndex] = new Map();
            processingPages.add(pageIndex);
        }

        // 如果此切片已处理过，则跳过
        if (pageSlices[pageIndex].has(leftValue)) {
            return;
        }

        // 记录该切片
        pageSlices[pageIndex].set(leftValue, imgElement);

        // 更新当前活动页面的进度条
        if (activePage == pageIndex) {
            updateProgressBar(pageIndex, pageSlices[pageIndex]);
            updateCurrentPageInfo(
                `当前页面: <b>第${pageIndex}页</b> (已加载 ${pageSlices[pageIndex].size} 个切片)`
            );
        }

        // 更新当前最小页面并跳转
        if (
            parseInt(pageIndex) < currentMinPage &&
            !completedPages.has(pageIndex)
        ) {
            currentMinPage = parseInt(pageIndex);
            jumpToPage(currentMinPage);
        }

        // 检查是否所有切片都已加载
        checkPageCompletion(bookId, pageIndex);
    }

    // 检查页面切片是否完整
    function checkPageCompletion(bookId, pageIndex) {
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

        // 如果所有切片都已加载，标记为待合并
        if (
            totalSlices > 0 &&
            currentSlices >= totalSlices &&
            !completedPages.has(pageIndex) &&
            !pendingPages.has(pageIndex)
        ) {
            console.log(`页${pageIndex}的所有切片已加载，标记为待合并`);
            pendingPages.add(pageIndex);

            // 如果是当前活动页面，立即合并
            if (activePage == pageIndex && isRunning) {
                console.log(
                    `当前活动页面${pageIndex}的所有切片已加载，开始合并...`
                );
                mergeAndSavePage(bookId, pageIndex);
            }
        }
    }

    // 合并切片并保存为完整页面
    function mergeAndSavePage(bookId, pageIndex) {
        if (
            !pageSlices[pageIndex] ||
            pageSlices[pageIndex].size === 0 ||
            completedPages.has(pageIndex) ||
            !isRunning
        ) {
            return;
        }

        // 从待合并集合中移除
        pendingPages.delete(pageIndex);

        updateStatusDisplay(`正在合并第${pageIndex}页...`);

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
                        processingPages.delete(pageIndex);

                        // 显示完成通知
                        showNotice(`✓ 第${pageIndex}页已保存为 ${filename}`);
                        updateStatusDisplay(`合并完成，继续处理...`);

                        // 在本页处理完成后，立即查找并跳转到下一页
                        console.log("准备查找下一个页面...");
                        findAndJumpToNextPage();
                    }, 100);
                },
                "image/webp",
                0.95
            );
        } catch (error) {
            console.error(`合并页${pageIndex}失败:`, error);
            updateStatusDisplay(`合并第${pageIndex}页时出错: ${error.message}`);
        }
    }

    // 找到下一个未完成的最小页面并跳转
    function findAndJumpToNextPage() {
        if (!isRunning) return;

        console.log("查找下一个未完成页面...");

        // 获取所有页码并排序
        const allPages = document.querySelectorAll(".page-img-box");
        const allPageIndices = [];

        allPages.forEach((page) => {
            const idx = parseInt(page.getAttribute("index"));
            if (idx >= startPage) {
                allPageIndices.push(idx);
            }
        });

        allPageIndices.sort((a, b) => a - b);

        // 找到下一个未完成的最小页面
        let nextPage = null;
        for (let i = 0; i < allPageIndices.length; i++) {
            const pageIdx = allPageIndices[i].toString();
            if (
                !completedPages.has(pageIdx) &&
                parseInt(pageIdx) >= startPage
            ) {
                nextPage = parseInt(pageIdx);
                break;
            }
        }

        if (nextPage !== null) {
            currentMinPage = nextPage;
            console.log(`跳转到下一页: ${nextPage}`);
            jumpToPage(nextPage);
        } else {
            updateStatusDisplay(`所有页面处理完成！`);
            showNotice(`✓ 所有页面处理完成！`, 0); // 不自动消失

            // 禁用取消按钮，启用开始按钮
            const cancelButton = document.getElementById("cancelButton");
            const startButton = document.getElementById("startButton");

            if (cancelButton) cancelButton.style.display = "none";
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = "重新开始";
                startButton.style.backgroundColor = "#4CAF50";
                startButton.style.display = "block";
            }

            isRunning = false;
        }
    }

    // 处理页面中现有的图片
    function processExistingImages() {
        if (!isRunning) return;

        const bookId = getBookId();
        console.log(`检测到书籍ID: ${bookId}`);

        document.querySelectorAll(".page-img-box").forEach((pageBox) => {
            const pageIndex = pageBox.getAttribute("index");
            if (parseInt(pageIndex) < startPage) return;

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
                        if (!isRunning) return;
                        const leftValue = parseFloat(img.style.left) || 0;
                        processSliceImage(img, bookId, pageIndex, leftValue);
                    });
                }
            });
        });
    }

    // 设置DOM观察器监视新添加的图片
    function setupObserver() {
        // 如果已有观察器，先断开
        if (observer) {
            observer.disconnect();
        }

        const bookId = getBookId();

        // 创建MutationObserver观察DOM变化
        observer = new MutationObserver((mutations) => {
            if (!isRunning) return;

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
                                if (parseInt(pageIndex) < startPage) return;

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
                                        if (!isRunning) return;
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

    // 停止所有处理
    function stopProcessing() {
        isRunning = false;

        // 断开观察器
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        updateStatusDisplay("已停止处理");
        showNotice("已取消处理", 3000);

        // 恢复开始按钮
        const startButton = document.getElementById("startButton");
        const cancelButton = document.getElementById("cancelButton");

        if (startButton) {
            startButton.disabled = false;
            startButton.textContent = "重新开始";
            startButton.style.backgroundColor = "#4CAF50";
            startButton.style.display = "block";
        }

        if (cancelButton) {
            cancelButton.style.display = "none";
        }
    }

    // 添加增强的交互界面
    function addEnhancedUI() {
        // 确保只创建一个面板
        if (panelCreated) return;

        // 添加样式
        const style = document.createElement("style");
        style.textContent = `
            #wqSlicerPanel {
                position: fixed;
                top: 10px;
                right: 10px;
                background-color: rgba(255,255,255,0.97);
                color: #333;
                padding: 12px;
                border-radius: 8px;
                z-index: 9999;
                width: 280px;
                font-family: 'Arial', sans-serif;
                box-shadow: 0 0 15px rgba(0,0,0,0.3);
                transition: all 0.3s ease;
            }
            
            #wqSlicerPanel .panel-header {
                font-weight: bold;
                margin-bottom: 12px;
                font-size: 15px;
                border-bottom: 1px solid #ddd;
                padding-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            #wqSlicerPanel .panel-section {
                margin-bottom: 12px;
                padding-bottom: 8px;
                border-bottom: 1px solid #eee;
            }
            
            #wqSlicerPanel .buttons-container {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
            }
            
            #wqSlicerPanel button {
                padding: 6px 12px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s;
            }
            
            #wqSlicerPanel button:hover {
                opacity: 0.9;
            }
            
            #wqSlicerPanel button:active {
                transform: scale(0.98);
            }
            
            #startButton {
                background: #4CAF50;
                color: white;
                flex-grow: 1;
            }
            
            #cancelButton {
                background: #f44336;
                color: white;
                flex-grow: 1;
                display: none;
            }
            
            #currentPageInfo {
                font-size: 13px;
                margin-bottom: 10px;
                color: #333;
            }
            
            #progressDisplay {
                margin: 10px 0;
            }
            
            .progress-container {
                display: flex;
                justify-content: space-between;
                height: 12px;
                margin: 5px 0;
                background: #f0f0f0;
                border-radius: 6px;
                overflow: hidden;
            }
            
            .progress-item {
                flex-grow: 1;
                height: 100%;
                background: #f0f0f0;
                margin: 0 1px;
                transition: all 0.3s ease;
            }
            
            .progress-item.loaded {
                background: #4CAF50;
            }
            
            #statusDisplay {
                font-size: 13px;
                color: #555;
                min-height: 20px;
            }
            
            #completionNotice {
                font-size: 13px;
                color: #4CAF50;
                min-height: 20px;
                margin-top: 8px;
                font-weight: bold;
                opacity: 0;
                transition: opacity 0.5s ease;
            }
        `;
        document.head.appendChild(style);

        // 移除可能存在的旧面板
        const oldPanel = document.getElementById("wqSlicerPanel");
        if (oldPanel) {
            oldPanel.remove();
        }

        // 创建面板
        const panel = document.createElement("div");
        panel.id = "wqSlicerPanel";
        panel.innerHTML = `
            <div class="panel-header">
                <span>文泉切片合并工具</span>
            </div>
            
            <div class="panel-section">
                <div class="buttons-container">
                    <button id="startButton">开始处理</button>
                    <button id="cancelButton">取消处理</button>
                </div>
            </div>
            
            <div class="panel-section">
                <div id="currentPageInfo">当前页面: 等待开始...</div>
                <div id="progressDisplay"></div>
            </div>
            
            <div class="panel-section">
                <div id="statusDisplay">点击"开始处理"按钮来启动工具</div>
                <div id="completionNotice"></div>
            </div>
        `;

        document.body.appendChild(panel);
        panelCreated = true;

        // 保存面板元素引用
        mainPanel = panel;
        statusDisplay = document.getElementById("statusDisplay");
        progressDisplay = document.getElementById("progressDisplay");
        currentPageInfo = document.getElementById("currentPageInfo");
        completionNotice = document.getElementById("completionNotice");

        // 添加按钮事件
        document
            .getElementById("startButton")
            .addEventListener("click", function () {
                if (!isInitialized || !isRunning) {
                    this.disabled = true;
                    this.textContent = "处理中...";
                    this.style.backgroundColor = "#888";
                    this.style.display = "none";

                    // 显示取消按钮
                    const cancelButton =
                        document.getElementById("cancelButton");
                    if (cancelButton) {
                        cancelButton.style.display = "block";
                    }

                    // 重置状态
                    if (isInitialized) {
                        // 如果是重新开始，重置一些状态但保留已完成页面的记录
                        isRunning = true;
                        initScript(false);
                    } else {
                        // 首次初始化
                        isRunning = true;
                        initScript(true);
                    }
                }
            });

        document
            .getElementById("cancelButton")
            .addEventListener("click", function () {
                stopProcessing();
            });

        // 初始化空进度条
        updateProgressBar(null, null);
    }

    // 初始化脚本，询问起始页面
    function initScript(isFirstTime = true) {
        if (isFirstTime) {
            // 重置状态
            currentMinPage = Infinity;
            pendingPages.clear();
            processingPages.clear();
            activePage = null;

            const userStartPage = prompt(
                "请输入要开始处理的页码 (按取消则从当前页开始)："
            );
            if (userStartPage && !isNaN(parseInt(userStartPage))) {
                startPage = parseInt(userStartPage);
                currentMinPage = startPage;
                jumpToPage(currentMinPage);
            } else {
                // 从当前可见的页面开始
                const currentPage = getCurrentVisiblePage();
                if (currentPage !== null) {
                    startPage = currentPage;
                    currentMinPage = startPage;
                } else {
                    // 如果无法确定当前页，使用第一个页面
                    const firstPage = document.querySelector(".page-img-box");
                    if (firstPage) {
                        startPage = parseInt(firstPage.getAttribute("index"));
                        currentMinPage = startPage;
                    }
                }
                jumpToPage(currentMinPage);
            }

            console.log(`开始处理，起始页为：${startPage}`);
            updateStatusDisplay(`开始处理，起始页：第${startPage}页`);
        } else {
            // 重新开始，但保留已完成页面的记录
            findAndJumpToNextPage();
        }

        processExistingImages();
        setupObserver();
        isInitialized = true;
    }

    // 页面加载完成后执行
    window.addEventListener("load", function () {
        console.log("页面已加载，添加交互界面");
        addEnhancedUI();
    });

    // 尝试立即添加交互界面
    setTimeout(addEnhancedUI, 500);
})();
