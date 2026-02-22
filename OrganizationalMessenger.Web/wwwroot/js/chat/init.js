import { setConnection, setIsPageFocused, currentChat } from './variables.js';
import { setupSignalR } from './signalr.js';
import { markMessagesAsRead, removeUnreadSeparator, loadMessageSettings } from './messages.js';
import { setupScrollListener, requestNotificationPermission } from './message-handlers.js';
import './message-menu.js';
import './forward.js';
import './reply.js';
import './reactions.js';

// ✅ Import ماژول‌های Group/Channel
import './modules/group/group-manager.js';
import './modules/channel/channel-manager.js';

// ✅ اضافه کردن sendMessage
import './sendMessage.js';

export async function initChat() {
    window.currentUserId = parseInt(document.getElementById('currentUserId')?.value || '0');
    console.log('🔍 Current User ID:', window.currentUserId);

    if (window.currentUserId === 0) {
        console.error('❌ Current User ID = 0');
        return;
    }

    console.log('🚀 Initializing chat...');

    await loadMessageSettings();
    console.log('✅ Message settings loaded');

    const conn = await setupSignalR();
    setConnection(conn);

    setupEventListeners();
    setupScrollListener();
    setupCreateMenu();
    requestNotificationPermission(); // ✅ درخواست مجوز نوتیفیکیشن

    window.addEventListener('focus', function () {
        setIsPageFocused(true);
        if (currentChat) {
            markMessagesAsRead();
            removeUnreadSeparator();
        }
    });

    window.addEventListener('blur', function () {
        setIsPageFocused(false);
    });

    console.log('✅ Init complete');
}

async function setupEventListeners() {
    console.log('🎯 Setting up event listeners...');

    const { selectChat, handleTabClick } = await import('./chats.js');
    const { sendTextMessage } = await import('./sendMessage.js'); // ✅ تغییر
    const { handleFileSelect } = await import('./files.js');
    const { toggleEmojiPicker } = await import('./emoji.js');
    const { setupVoiceRecording } = await import('./voice.js');

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            sendTextMessage(); // ✅ تغییر
            setTimeout(() => {
                removeUnreadSeparator();
            }, 500);
        });
    }

    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextMessage(); // ✅ تغییر
                setTimeout(() => {
                    removeUnreadSeparator();
                }, 500);
            }
        });
    }

    const attachBtn = document.getElementById('attachBtn');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            document.getElementById('fileInput')?.click();
        });
    }

    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    const emojiBtn = document.getElementById('emojiBtn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleEmojiPicker();
        });
    }

    document.addEventListener('click', function (e) {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            selectChat(chatItem);
            return;
        }

        const tabBtn = e.target.closest('.tab-btn');
        if (tabBtn) {
            handleTabClick(tabBtn);
            return;
        }
    });

   

    setupVoiceRecording();
    setupChatSearch();
    setupPasteHandler(); // ✅ اضافه شد
    await setupHeaderEventListeners();

    console.log('✅ Event listeners attached');
}

async function setupHeaderEventListeners() {
    console.log('🎯 Setting up header event listeners...');

    const manageMembersBtn = document.getElementById('manageMembersBtn');
    if (manageMembersBtn) {
        manageMembersBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const chatId = parseInt(e.currentTarget.dataset.chatId);
            const chatType = e.currentTarget.dataset.chatType;

            console.log('👥 Manage members clicked:', chatType, chatId);

            if (chatType === 'group' && window.groupManager) {
                await window.groupManager.showMembersDialog(chatId);
            } else if (chatType === 'channel' && window.channelManager) {
                await window.channelManager.showMembersDialog(chatId);
            }
        });
    }

    const callVoiceBtn = document.getElementById('callVoiceBtn');
    if (callVoiceBtn) {
        callVoiceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('📞 Voice call clicked');
            alert('تماس صوتی - به زودی');
        });
    }

    const callVideoBtn = document.getElementById('callVideoBtn');
    if (callVideoBtn) {
        callVideoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('📹 Video call clicked');
            alert('تماس تصویری - به زودی');
        });
    }

    const moreBtn = document.getElementById('moreBtn');
    if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('⋮⋮⋮ More clicked');
        });
    }

    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            console.log('⬅️ Back clicked');
        });
    }

    console.log('✅ Header event listeners attached');
}

function setupCreateMenu() {
    const createMenuBtn = document.getElementById('createMenuBtn');
    const createMenu = document.getElementById('createMenu');

    if (createMenuBtn && createMenu) {
        createMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = createMenu.style.display === 'block';
            createMenu.style.display = isVisible ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!createMenu.contains(e.target) && e.target !== createMenuBtn) {
                createMenu.style.display = 'none';
            }
        });

        console.log('✅ Create menu initialized');
    }
}




// ✅ Ctrl+V - چسباندن فایل/تصویر از کلیپبورد
// ✅ Ctrl+V - چسباندن فایل/تصویر از کلیپبورد
function setupPasteHandler() {
    document.addEventListener('paste', (e) => {
        // ✅ ابتدا sync بررسی کن - قبل از هر await
        const items = e.clipboardData?.items;
        if (!items) return;

        // ✅ پیدا کردن فایل به صورت sync
        let fileItem = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                fileItem = items[i];
                break;
            }
        }
        if (!fileItem) return; // فایلی نیست، بذار مرورگر متن رو paste کنه

        e.preventDefault(); // ✅ باید قبل از async باشه

        const file = fileItem.getAsFile(); // ✅ sync بخون
        if (!file) return;

        // ✅ حالا async بخش شروع میشه
        (async () => {
            // بررسی currentChat از ماژول
            const { currentChat } = await import('./variables.js');
            if (!currentChat) {
                console.log('⚠️ Paste ignored - no chat selected');
                return;
            }

            console.log('📋 Paste detected:', file.name, file.type, file.size);

            let finalFile = file;
            if (file.type.startsWith('image/') && file.name === 'image.png') {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const ext = file.type.split('/')[1] || 'png';
                finalFile = new File([file], `screenshot-${timestamp}.${ext}`, { type: file.type });
            }

            if (finalFile.size > 100 * 1024 * 1024) {
                alert('حجم فایل نباید بیشتر از 100 مگابایت باشد');
                return;
            }

            const filesModule = await import('./files.js');
            filesModule.showPasteDialog(finalFile);
        })();
    });

    console.log('✅ Paste handler initialized');
}
export function toggleMessageInput(show) {
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = show ? 'flex' : 'none';
    }
}


function setupChatSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    let searchTimeout;

    // ✅ فوکوس: بزرگ شدن کادر جستجو
    searchInput.addEventListener('focus', () => {
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            headerRight.classList.add('search-expanded');
        }
        searchInput.parentElement?.classList.add('search-box-expanded');
    });

    // ✅ از دست دادن فوکوس: برگشت به حالت عادی (فقط اگر خالیه)
    searchInput.addEventListener('blur', () => {
        // با تأخیر کوتاه تا اگر روی نتیجه کلیک شد، مشکلی نباشه
        setTimeout(() => {
            if (!searchInput.value.trim()) {
                const headerRight = document.querySelector('.header-right');
                if (headerRight) {
                    headerRight.classList.remove('search-expanded');
                }
                searchInput.parentElement?.classList.remove('search-box-expanded');
            }
        }, 200);
    });

    // ✅ جستجو با debounce
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim().toLowerCase();

        searchTimeout = setTimeout(() => {
            filterChatList(query);
        }, 200);
    });

    // ✅ ESC: خالی کردن و بستن
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchInput.blur();
            filterChatList('');

            const headerRight = document.querySelector('.header-right');
            if (headerRight) {
                headerRight.classList.remove('search-expanded');
            }
            searchInput.parentElement?.classList.remove('search-box-expanded');
        }
    });

    console.log('✅ Chat search initialized');
}
function filterChatList(query) {
    const { getChatsData } = window._chatModule || {};

    // اگر query خالیه، لیست اصلی رو نشون بده
    if (!query) {
        import('./chats.js').then(module => module.loadChats('all'));
        return;
    }

    const chatsData = window.chats || [];
    if (chatsData.length === 0) return;

    // ✅ فیلتر بر اساس نام
    const filtered = chatsData.filter(chat => {
        const name = (chat.name || '').toLowerCase();
        return name.includes(query);
    });

    // ✅ رندر نتایج
    const container = document.getElementById('chatList');
    if (!container) return;

    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="search-no-result">
                <i class="fas fa-search"></i>
                <p>نتیجه‌ای یافت نشد</p>
            </div>
        `;
        return;
    }

    // دسته‌بندی نتایج
    const privateResults = filtered.filter(c => c.type === 'private');
    const groupResults = filtered.filter(c => c.type === 'group');
    const channelResults = filtered.filter(c => c.type === 'channel');

    import('./chats.js').then(module => {
        if (privateResults.length > 0) {
            renderSearchSection(container, 'افراد', 'fa-user');
            privateResults.forEach(chat => module.renderChatItem(chat));
        }
        if (groupResults.length > 0) {
            renderSearchSection(container, 'گروه‌ها', 'fa-users');
            groupResults.forEach(chat => module.renderChatItem(chat));
        }
        if (channelResults.length > 0) {
            renderSearchSection(container, 'کانال‌ها', 'fa-bullhorn');
            channelResults.forEach(chat => module.renderChatItem(chat));
        }
    });
}

function renderSearchSection(container, title, icon) {
    const header = document.createElement('div');
    header.className = 'chat-section-header';
    header.innerHTML = `
        <div class="section-line"></div>
        <span class="section-title"><i class="fas ${icon}"></i> ${title}</span>
        <div class="section-line"></div>
    `;
    container.appendChild(header);
}