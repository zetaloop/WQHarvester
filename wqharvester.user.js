// ==UserScript==
// @name         WQHarvester 文泉收割机
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  下载文泉书局已购电子书，自动合并阅读器中的书页切片并下载为完整页面图片，需结合仓库里的另一个 Python 脚本使用。
// @author       zetaloop
// @homepage     https://github.com/zetaloop/WQHarvester
// @match        https://wqbook.wqxuetang.com/deep/read/*
// @match        *://wqbook.wqxuetang.com/deep/read/*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    console.log("文泉收割机已加载");

    // 跟踪每页的切片加载情况，key为页面index，值为Map {leftValue -> {img, count}}
    const pageSlices = {};

    // 当前处理的最小页面
    let currentMinPage = Infinity;

    // 起始页面
    let startPage = 1;

    // 已完成（合并保存）的页面集合
    const completedPages = new Set();

    // 待合并的页面集合（切片已加载完成但尚未合并）
    const pendingPages = new Set();

    // 处理中的页面集合（等待切片加载中）
    const processingPages = new Set();

    // 当前活动页面（用于控制只合并当前页）
    let activePage = null;

    // 是否正在运行
    let isRunning = false;

    // 脚本是否已初始化
    let isInitialized = false;

    // 是否有面板已创建
    let panelCreated = false;

    // DOM观察器引用
    let observer = null;

    // 页面跳转定时器（确保同时只有一个跳转等待）
    let jumpTimeout = null;

    // 面板各元素引用
    let mainPanel,
        statusDisplay,
        progressDisplay,
        currentPageInfo,
        mergedProgressDisplay,
        completionNotice;

    // 消息定时器
    let noticeTimer = null;

    // 自动点击“重新加载本页”按钮的定时器
    let reloadInterval = null;

    // 全局合并用的画布，复用以提升效率
    let mergeCanvas = null;

    // 提取书籍ID
    function getBookId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get("bid") || "unknown";
    }

    // 自动检测并点击“重新加载本页”按钮（每秒检测一次）
    function checkReloadButton() {
        const reloadButtons = document.querySelectorAll(".reload_image");
        reloadButtons.forEach((btn) => {
            if (btn.offsetParent !== null) {
                // 如果元素可见
                const pageBox = btn.closest(".page-img-box");
                if (pageBox) {
                    const pageIndex = pageBox.getAttribute("index");
                    if (!completedPages.has(pageIndex)) {
                        console.log(
                            `检测到页面 ${pageIndex} 的“重新加载本页”按钮，自动点击`
                        );
                        updateStatusDisplay(
                            `检测到页面 ${pageIndex} 重载按钮，正在点击...`
                        );
                        btn.click();
                    }
                }
            }
        });
    }

    // 显示临时通知消息
    function showNotice(message, duration = 3000) {
        if (!completionNotice) return;
        if (noticeTimer) clearTimeout(noticeTimer);
        completionNotice.textContent = message;
        completionNotice.style.opacity = "1";
        noticeTimer = setTimeout(() => {
            completionNotice.style.opacity = "0";
        }, duration);
    }

    // 更新状态信息显示
    function updateStatusDisplay(message) {
        if (statusDisplay) {
            statusDisplay.textContent = message;
        }
    }

    // 更新当前页面加载进度显示（针对切片加载进度，显示当前页及加载的切片数量）
    function updateCurrentPageInfo(message) {
        if (currentPageInfo) {
            currentPageInfo.innerHTML = message;
        }
    }

    // 更新当前页面的加载进度条（基于切片加载情况，按left区间分6块；颜色根据加载次数）
    function updateProgressBar(pageIndex, slices) {
        if (!progressDisplay) return;
        progressDisplay.innerHTML = "";
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
        // 获取所有切片条目，并转换left为数字，保留count信息
        const sliceEntries = Array.from(slices.entries()).map(([left, obj]) => [
            parseFloat(left),
            obj,
        ]);
        sliceEntries.sort((a, b) => a[0] - b[0]);
        const minLeft = sliceEntries[0][0];
        const maxLeft = sliceEntries[sliceEntries.length - 1][0];
        const range = maxLeft - minLeft;
        const interval = range / 5; // 分成6段

        const container = document.createElement("div");
        container.className = "progress-container";

        // 为每个区间创建一个进度块
        for (let i = 0; i < 6; i++) {
            const lowerBound =
                i === 0 ? minLeft - 0.1 : minLeft + interval * (i - 0.01);
            const upperBound =
                i === 5 ? maxLeft + 0.1 : minLeft + interval * (i + 1.01);
            const progressItem = document.createElement("div");
            progressItem.className = "progress-item";

            // 找到落在该区间的切片，计算最大加载次数
            const entriesInInterval = sliceEntries.filter(
                ([left, obj]) => left >= lowerBound && left <= upperBound
            );
            if (entriesInInterval.length > 0) {
                const maxCount = Math.max(
                    ...entriesInInterval.map((e) => e[1].count)
                );
                // 第一次加载（count==1）使用淡绿色，否则使用深绿色
                if (maxCount === 1) {
                    progressItem.classList.add("loaded-light");
                } else {
                    progressItem.classList.add("loaded-dark");
                }
            }
            container.appendChild(progressItem);
        }

        progressDisplay.appendChild(container);
    }

    // 更新合并进度显示（显示已合并页数 / 总页数）
    function updateMergedProgress() {
        if (!mergedProgressDisplay) return;
        const totalPages = document.querySelectorAll(".page-img-box").length;
        mergedProgressDisplay.textContent = `合并进度：已合并 ${completedPages.size} / ${totalPages} 页`;
    }

    // 获取当前视口中最“可见”的页面索引
    function getCurrentVisiblePage() {
        const pageElements = document.querySelectorAll(".page-img-box");
        if (!pageElements || pageElements.length === 0) return null;
        const windowHeight = window.innerHeight;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        let bestVisiblePage = null,
            bestVisibility = 0;
        pageElements.forEach((page) => {
            const rect = page.getBoundingClientRect();
            const pageTop = rect.top + scrollTop;
            const pageBottom = rect.bottom + scrollTop;
            const visibleTop = Math.max(pageTop, scrollTop);
            const visibleBottom = Math.min(
                pageBottom,
                scrollTop + windowHeight
            );
            const visibleHeight = Math.max(0, visibleBottom - visibleTop);
            if (visibleHeight > bestVisibility) {
                bestVisibility = visibleHeight;
                bestVisiblePage = parseInt(page.getAttribute("index"));
            }
        });
        return bestVisiblePage;
    }

    // 修改后的跳转函数：滚动后立即尝试合并，500ms后检查视口位置，如未到位则重试滚动
    function jumpToPage(pageIndex, isRetry = false) {
        const pageBox = document.querySelector(
            `.page-img-box[index="${pageIndex}"]`
        );
        if (!pageBox) {
            console.log(`找不到第${pageIndex}页元素`);
            updateStatusDisplay(`找不到第${pageIndex}页元素`);
            return;
        }
        pageBox.scrollIntoView({ behavior: "smooth", block: "end" });
        console.log(`正在跳转第${pageIndex}页${isRetry ? "(重试)" : ""}`);
        updateStatusDisplay(`正在跳转第${pageIndex}页...`);

        // 立即检查：如果该页已标记为待合并，则立刻开始合并
        if (pendingPages.has(pageIndex.toString()) && isRunning) {
            console.log(`当前活动页面${pageIndex}切片已加载，立即开始合并...`);
            mergeAndSavePage(getBookId(), pageIndex.toString());
        }

        // 500ms后检查当前视口是否正确，如有偏差则重试滚动，并强制调用页面完成检测
        if (jumpTimeout) clearTimeout(jumpTimeout);
        jumpTimeout = setTimeout(() => {
            jumpTimeout = null;
            const currentPage = getCurrentVisiblePage();
            console.log(`跳转后检测: 目标=${pageIndex}, 当前=${currentPage}`);
            if (
                currentPage !== null &&
                Math.abs(currentPage - pageIndex) > 2 &&
                !isRetry
            ) {
                console.log(`跳转偏差过大，再次尝试跳转到第${pageIndex}页`);
                jumpToPage(pageIndex, true);
            } else {
                updateStatusDisplay(`正在转到第${pageIndex}页...`);
                activePage = pageIndex;
                if (pageSlices[pageIndex]) {
                    updateProgressBar(pageIndex, pageSlices[pageIndex]);
                    updateCurrentPageInfo(
                        `当前页面：<b>第${pageIndex}页</b> (加载切片 ${pageSlices[pageIndex].size} 个)`
                    );
                } else {
                    updateProgressBar(pageIndex, null);
                    updateCurrentPageInfo(
                        `当前页面：<b>第${pageIndex}页</b> (尚未加载切片)`
                    );
                }
                // 强制再次检查页面是否已完成加载
                checkPageCompletion(getBookId(), pageIndex);
            }
        }, 500);
    }

    // 处理并记录单个切片图片（同一 left 值如果重复，则累加 count）
    function processSliceImage(imgElement, bookId, pageIndex, leftValue) {
        if (!isRunning || parseInt(pageIndex) < startPage) return;
        if (!pageSlices[pageIndex]) {
            pageSlices[pageIndex] = new Map();
            processingPages.add(pageIndex);
        }
        if (pageSlices[pageIndex].has(leftValue)) {
            // 重复加载，累加计数
            let entry = pageSlices[pageIndex].get(leftValue);
            entry.count++;
            pageSlices[pageIndex].set(leftValue, entry);
        } else {
            pageSlices[pageIndex].set(leftValue, { img: imgElement, count: 1 });
        }
        if (activePage == pageIndex) {
            updateProgressBar(pageIndex, pageSlices[pageIndex]);
            updateCurrentPageInfo(
                `当前页面：<b>第${pageIndex}页</b> (加载切片 ${pageSlices[pageIndex].size} 个)`
            );
        }
        if (
            parseInt(pageIndex) < currentMinPage &&
            !completedPages.has(pageIndex)
        ) {
            currentMinPage = parseInt(pageIndex);
            jumpToPage(currentMinPage);
        }
        checkPageCompletion(bookId, pageIndex);
    }

    // 检查页面切片是否全部加载完成
    function checkPageCompletion(bookId, pageIndex) {
        const pageBox = document.querySelector(
            `.page-img-box[index="${pageIndex}"]`
        );
        if (!pageBox) return;
        const plgContainer = pageBox.querySelector(".plg");
        if (!plgContainer) return;
        const totalSlices = plgContainer.querySelectorAll("img").length;
        const currentSlices = pageSlices[pageIndex]
            ? pageSlices[pageIndex].size
            : 0;
        if (
            totalSlices > 0 &&
            currentSlices >= totalSlices &&
            !completedPages.has(pageIndex) &&
            !pendingPages.has(pageIndex)
        ) {
            console.log(`第${pageIndex}页的所有切片已加载，标记为待合并`);
            pendingPages.add(pageIndex);
            if (activePage == pageIndex && isRunning) {
                console.log(`当前活动页面${pageIndex}切片已加载，开始合并...`);
                mergeAndSavePage(bookId, pageIndex);
            }
        }
    }

    // 合并切片并保存为完整页面（保存文件名不带 _complete）——优化点：复用全局画布，优先使用 OffscreenCanvas
    function mergeAndSavePage(bookId, pageIndex) {
        if (
            !pageSlices[pageIndex] ||
            pageSlices[pageIndex].size === 0 ||
            completedPages.has(pageIndex) ||
            !isRunning
        )
            return;
        pendingPages.delete(pageIndex);
        updateStatusDisplay(`正在合并第${pageIndex}页...`);
        try {
            const sortedSlices = Array.from(
                pageSlices[pageIndex].entries()
            ).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
            let totalWidth = 0,
                maxHeight = 0;
            sortedSlices.forEach(([left, entry]) => {
                totalWidth += entry.img.naturalWidth;
                maxHeight = Math.max(maxHeight, entry.img.naturalHeight);
            });
            // 初始化或复用全局画布
            if (!mergeCanvas) {
                if (typeof OffscreenCanvas !== "undefined") {
                    mergeCanvas = new OffscreenCanvas(totalWidth, maxHeight);
                } else {
                    mergeCanvas = document.createElement("canvas");
                }
            }
            mergeCanvas.width = totalWidth;
            mergeCanvas.height = maxHeight;
            const ctx = mergeCanvas.getContext("2d");
            let currentX = 0;
            sortedSlices.forEach(([left, entry]) => {
                ctx.drawImage(entry.img, currentX, 0);
                currentX += entry.img.naturalWidth;
            });
            // 文件名格式：{bookid}_page{pageIndex}.webp
            const filename = `${bookId}_page${pageIndex}.webp`;
            // 如果使用 OffscreenCanvas 优先使用 convertToBlob
            if (
                mergeCanvas instanceof OffscreenCanvas &&
                mergeCanvas.convertToBlob
            ) {
                mergeCanvas
                    .convertToBlob({ type: "image/webp", quality: 0.95 })
                    .then((blob) => {
                        saveBlob(blob, filename, pageIndex);
                    });
            } else {
                mergeCanvas.toBlob(
                    function (blob) {
                        saveBlob(blob, filename, pageIndex);
                    },
                    "image/webp",
                    0.95
                );
            }
        } catch (error) {
            console.error(`合并第${pageIndex}页失败：`, error);
            updateStatusDisplay(`合并第${pageIndex}页时出错：${error.message}`);
        }
    }
    // 将生成的 Blob 保存为下载文件
    function saveBlob(blob, filename, pageIndex) {
        if (!saveBlob.savedFiles) {
            saveBlob.savedFiles = new Set();
        }
        if (saveBlob.savedFiles.has(filename)) {
            console.log(`文件 ${filename} 已经保存，跳过重复保存`);
            setTimeout(() => {
                completedPages.add(pageIndex);
                processingPages.delete(pageIndex);
                showNotice(`✓ 第${pageIndex}页已保存为 ${filename}`);
                updateStatusDisplay(`合并完成，继续处理...`);
                updateMergedProgress();
                console.log("查找下一个未合并页面...");
                findAndJumpToNextPage();
            }, 100);
            return;
        }
        saveBlob.savedFiles.add(filename);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
            document.body.removeChild(link);
            console.log(`已保存合并页面：${filename}`);
            completedPages.add(pageIndex);
            processingPages.delete(pageIndex);
            showNotice(`✓ 第${pageIndex}页已保存为 ${filename}`);
            updateStatusDisplay(`合并完成，继续处理...`);
            updateMergedProgress();
            console.log("查找下一个未合并页面...");
            findAndJumpToNextPage();
        }, 100);
    }

    // 查找并跳转到下一个未合并页面
    function findAndJumpToNextPage() {
        if (!isRunning) return;
        console.log("查找下一个未合并页面...");
        const allPages = document.querySelectorAll(".page-img-box");
        const allPageIndices = [];
        allPages.forEach((page) => {
            const idx = parseInt(page.getAttribute("index"));
            if (idx >= startPage) allPageIndices.push(idx);
        });
        allPageIndices.sort((a, b) => a - b);
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
            console.log(`跳转到下一未合并页面：${nextPage}`);
            jumpToPage(nextPage);
        } else {
            updateStatusDisplay(`所有页面处理完成！`);
            showNotice(`✓ 所有页面处理完成！`, 0);
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

    // 处理页面中已有的图片
    function processExistingImages() {
        if (!isRunning) return;
        const bookId = getBookId();
        console.log(`检测到书籍ID：${bookId}`);
        document.querySelectorAll(".page-img-box").forEach((pageBox) => {
            const pageIndex = pageBox.getAttribute("index");
            if (parseInt(pageIndex) < startPage) return;
            const plgContainer = pageBox.querySelector(".plg");
            if (!plgContainer) return;
            const sliceImages = plgContainer.querySelectorAll("img");
            sliceImages.forEach((img) => {
                if (img.complete && img.naturalHeight !== 0) {
                    const leftValue = parseFloat(img.style.left) || 0;
                    processSliceImage(img, bookId, pageIndex, leftValue);
                } else {
                    img.addEventListener("load", function () {
                        if (!isRunning) return;
                        const leftValue = parseFloat(img.style.left) || 0;
                        processSliceImage(img, bookId, pageIndex, leftValue);
                    });
                }
            });
        });
    }

    // 设置DOM观察器监控新添加的图片
    function setupObserver() {
        if (observer) {
            observer.disconnect();
        }
        const bookId = getBookId();
        observer = new MutationObserver((mutations) => {
            if (!isRunning) return;
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach((node) => {
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
        const config = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "style"],
        };
        observer.observe(document.body, config);
    }

    // 停止所有处理
    function stopProcessing() {
        isRunning = false;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        updateStatusDisplay("已停止处理");
        showNotice("已取消处理", 3000);
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
        if (reloadInterval) {
            clearInterval(reloadInterval);
            reloadInterval = null;
        }
    }

    // 添加增强的交互界面（包括进度显示、按钮、以及自动点击重载按钮）
    function addEnhancedUI() {
        if (panelCreated) return;
        const style = document.createElement("style");
        style.textContent = `
            #wqSlicerPanel {
                position: fixed;
                top: 100px;
                right: 10px;
                background-color: rgba(255,255,255,0.97);
                color: #333;
                padding: 12px;
                border-radius: 8px;
                z-index: 9999;
                width: 300px;
                font-family: Arial, sans-serif;
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
            #wqSlicerPanel button:hover { opacity: 0.9; }
            #wqSlicerPanel button:active { transform: scale(0.98); }
            #startButton { background: #4CAF50; color: white; flex-grow: 1; }
            #cancelButton { background: #f44336; color: white; flex-grow: 1; display: none; }
            #currentPageInfo { font-size: 13px; margin-bottom: 10px; color: #333; }
            #progressDisplay { margin: 10px 0; }
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
            .progress-item.loaded-light { background: #a8d5a2; }
            .progress-item.loaded-dark { background: #4CAF50; }
            #statusDisplay, #mergedProgressDisplay, #completionNotice { font-size: 13px; color: #555; min-height: 20px; }
            #mergedProgressDisplay { margin-top: 5px; }
            #completionNotice { color: #4CAF50; margin-top: 8px; font-weight: bold; opacity: 0; transition: opacity 0.5s ease; }
        `;
        document.head.appendChild(style);

        const oldPanel = document.getElementById("wqSlicerPanel");
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement("div");
        panel.id = "wqSlicerPanel";
        panel.innerHTML = `
            <div class="panel-header">
                <span>文泉收割机</span>
            </div>
            <div class="panel-section">
                <div class="buttons-container">
                    <button id="startButton">开始处理</button>
                    <button id="cancelButton">取消处理</button>
                </div>
            </div>
            <div class="panel-section">
                <div id="currentPageInfo">当前页面：等待开始...</div>
                <div id="progressDisplay"></div>
            </div>
            <div class="panel-section">
                <div id="mergedProgressDisplay">合并进度：0 页</div>
                <div id="statusDisplay">点击“开始处理”启动工具</div>
                <div id="completionNotice"></div>
            </div>
        `;
        document.body.appendChild(panel);
        panelCreated = true;

        mainPanel = panel;
        statusDisplay = document.getElementById("statusDisplay");
        progressDisplay = document.getElementById("progressDisplay");
        currentPageInfo = document.getElementById("currentPageInfo");
        mergedProgressDisplay = document.getElementById(
            "mergedProgressDisplay"
        );
        completionNotice = document.getElementById("completionNotice");

        document
            .getElementById("startButton")
            .addEventListener("click", function () {
                if (!isInitialized || !isRunning) {
                    this.disabled = true;
                    this.textContent = "处理中...";
                    this.style.backgroundColor = "#888";
                    this.style.display = "none";
                    const cancelButton =
                        document.getElementById("cancelButton");
                    if (cancelButton) cancelButton.style.display = "block";
                    if (isInitialized) {
                        isRunning = true;
                        initScript(false);
                    } else {
                        isRunning = true;
                        initScript(true);
                    }
                    // 启动自动点击重载按钮的检测，每秒执行一次
                    if (!reloadInterval) {
                        reloadInterval = setInterval(checkReloadButton, 1000);
                    }
                }
            });

        document
            .getElementById("cancelButton")
            .addEventListener("click", function () {
                stopProcessing();
            });

        updateProgressBar(null, null);
        updateMergedProgress();
    }

    // 初始化脚本，询问起始页面
    function initScript(isFirstTime = true) {
        if (isFirstTime) {
            currentMinPage = Infinity;
            pendingPages.clear();
            processingPages.clear();
            activePage = null;
            const userStartPage = prompt(
                "请输入要开始处理的页码 (取消则使用当前页)："
            );
            if (userStartPage && !isNaN(parseInt(userStartPage))) {
                startPage = parseInt(userStartPage);
                currentMinPage = startPage;
                jumpToPage(currentMinPage);
            } else {
                const currentPage = getCurrentVisiblePage();
                if (currentPage !== null) {
                    startPage = currentPage;
                    currentMinPage = startPage;
                } else {
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
