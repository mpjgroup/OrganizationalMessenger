// ========================================
// Chat List Management
// ========================================

import { currentChat, setCurrentChat, setLastSenderId, setMessageGroupCount, setHasMoreMessages, setIsPageFocused } from './variables.js';
import { loadMessages, markMessagesAsRead, removeUnreadSeparator } from './messages.js';
import { escapeHtml, formatPersianTime, getInitials, scrollToBottom, getCsrfToken } from './utils.js';
import { toggleMessageInput } from './init.js';

let chatsData = [];

export async function loadChats(tab = 'all') {
    console.log('📋 Loading chats, tab:', tab);
    try {
        const response = await fetch(`/Chat/GetChats?tab=${tab}`);
        if (!response.ok) return;

        const chats = await response.json();
        chatsData = chats;
        window.chats = chatsData;

        const container = document.getElementById('chatList');
        if (!container) return;

        container.innerHTML = '';

        if (tab === 'all') {
            const privateChats = chats.filter(c => c.type === 'private');
            const groupChats = chats.filter(c => c.type === 'group');
            const channelChats = chats.filter(c => c.type === 'channel');

            // 👤 افراد
            renderSectionHeader(container, 'افراد', 'fa-user', () => showNewChatDialog());
            if (privateChats.length > 0) {
                privateChats.forEach(chat => renderChatItem(chat));
            } else {
                renderEmptySection(container, 'هنوز با کسی گفتگو نکرده‌اید');
            }

            // 👥 گروه‌ها
            if (groupChats.length > 0) {
                renderSectionHeader(container, 'گروه‌ها', 'fa-users');
                groupChats.forEach(chat => renderChatItem(chat));
            }

            // 📢 کانال‌ها
            if (channelChats.length > 0) {
                renderSectionHeader(container, 'کانال‌ها', 'fa-bullhorn');
                channelChats.forEach(chat => renderChatItem(chat));
            }
        } else {
            chats.forEach(chat => renderChatItem(chat));
        }

        console.log('✅ Chat list rendered');
        await updateTabBadges();
    } catch (error) {
        console.error('❌ Load chats error:', error);
    }
}

// ✅ هدر بخش با خط جداکننده و دکمه +
function renderSectionHeader(container, title, icon, onAddClick = null) {
    const header = document.createElement('div');
    header.className = 'chat-section-header';
    header.innerHTML = `
        <div class="section-line"></div>
        <span class="section-title"><i class="fas ${icon}"></i> ${title}</span>
        ${onAddClick ? '<button class="section-add-btn" title="شروع گفتگوی جدید"><i class="fas fa-plus"></i></button>' : ''}
        <div class="section-line"></div>
    `;

    if (onAddClick) {
        const addBtn = header.querySelector('.section-add-btn');
        if (addBtn) addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onAddClick();
        });
    }

    container.appendChild(header);
}

function renderEmptySection(container, text) {
    const el = document.createElement('div');
    el.className = 'chat-section-empty';
    el.textContent = text;
    container.appendChild(el);
}

// ✅ پاپ‌آپ جستجوی کاربر - با لیست اولیه
async function showNewChatDialog() {
    document.querySelector('.new-chat-dialog-overlay')?.remove();

    const dialog = document.createElement('div');
    dialog.className = 'new-chat-dialog-overlay';
    dialog.innerHTML = `
        <div class="new-chat-dialog">
            <div class="new-chat-dialog-header">
                <h3><i class="fas fa-user-plus"></i> گفتگوی جدید</h3>
                <button class="close-dialog" id="closeNewChatDialog">✕</button>
            </div>
            <div class="new-chat-dialog-body">
                <input type="text" id="newChatSearchInput" class="new-chat-search" 
                       placeholder="جستجوی نام یا شماره..." autofocus />
                <div class="new-chat-results" id="newChatResults">
                    <p class="search-hint"><i class="fas fa-spinner fa-spin"></i> در حال بارگذاری...</p>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    document.body.style.overflow = 'hidden';

    // بستن
    document.getElementById('closeNewChatDialog').addEventListener('click', () => {
        dialog.remove();
        document.body.style.overflow = 'auto';
    });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.remove();
            document.body.style.overflow = 'auto';
        }
    });

    // ✅ لود اولیه - همه کاربران
    await searchUsersForChat('');

    // جستجو با debounce
    let searchTimeout;
    document.getElementById('newChatSearchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        searchTimeout = setTimeout(() => searchUsersForChat(query), 300);
    });
}

async function searchUsersForChat(query) {
    const resultsContainer = document.getElementById('newChatResults');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '<p class="search-hint"><i class="fas fa-spinner fa-spin"></i> در حال جستجو...</p>';

    try {
        const response = await fetch(`/Chat/SearchUsers?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (!data.success || data.users.length === 0) {
            resultsContainer.innerHTML = '<p class="search-hint">کاربری یافت نشد</p>';
            return;
        }

        resultsContainer.innerHTML = data.users.map(user => `
            <div class="new-chat-user-item" data-user-id="${user.id}">
                <img src="${user.avatar}" class="new-chat-avatar" alt="${escapeHtml(user.name)}" 
                     onerror="this.src='/images/default-avatar.png'" />
                <div class="new-chat-user-info">
                    <span class="new-chat-user-name">${escapeHtml(user.name)}</span>
                    ${user.isOnline ? '<span class="online-dot"></span>' : ''}
                </div>
                <button class="new-chat-send-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.name)}" data-user-avatar="${user.avatar}">
                    <i class="fas fa-paper-plane"></i> ارسال پیام
                </button>
            </div>
        `).join('');

        // کلیک روی ارسال پیام
        resultsContainer.querySelectorAll('.new-chat-send-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = parseInt(btn.dataset.userId);
                const userName = btn.dataset.userName;
                const userAvatar = btn.dataset.userAvatar;
                startNewChat(userId, userName, userAvatar);
            });
        });

    } catch (error) {
        console.error('❌ Search error:', error);
        resultsContainer.innerHTML = '<p class="search-hint">خطا در جستجو</p>';
    }
}

function startNewChat(userId, userName, userAvatar) {
    // بستن dialog
    document.querySelector('.new-chat-dialog-overlay')?.remove();
    document.body.style.overflow = 'auto';

    // ✅ ست کردن چت فعلی
    setCurrentChat({
        id: userId,
        type: 'private',
        name: userName
    });

    // ✅ آپدیت هدر فوری
    const chatTitleEl = document.getElementById('chatTitle');
    if (chatTitleEl) chatTitleEl.textContent = userName;

    const chatAvatarSmall = document.querySelector('.chat-avatar-small');
    if (chatAvatarSmall) {
        if (userAvatar && userAvatar !== '/images/default-avatar.png') {
            chatAvatarSmall.innerHTML = `<img src="${userAvatar}" class="chat-avatar-img-small" alt="${escapeHtml(userName)}" onerror="this.parentElement.innerHTML='<div class=\\'chat-avatar-initials-small\\'>${getInitials(userName)}</div>'" />`;
        } else {
            chatAvatarSmall.innerHTML = `<div class="chat-avatar-initials-small">${getInitials(userName)}</div>`;
        }
    }

    // ✅ نمایش دکمه‌های تماس (خصوصی)
    const callVoiceBtn = document.getElementById('callVoiceBtn');
    const callVideoBtn = document.getElementById('callVideoBtn');
    if (callVoiceBtn) callVoiceBtn.style.display = 'flex';
    if (callVideoBtn) callVideoBtn.style.display = 'flex';

    // ✅ مخفی کردن مدیریت اعضا
    const manageMembersBtn = document.getElementById('manageMembersBtn');
    if (manageMembersBtn) manageMembersBtn.style.display = 'none';

    // ✅ نمایش input area
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = 'flex';
        inputArea.classList.add('show');
    }

    // ✅ لود پیام‌ها (اگر قبلا بوده خالی میاد)
    setLastSenderId(null);
    setMessageGroupCount(0);
    setHasMoreMessages(true);
    loadMessages(false);

    // ✅ highlight کردن در لیست (اگر وجود داره)
    document.querySelectorAll('.chat-item')?.forEach(item => item.classList.remove('active'));
    const existingItem = document.querySelector(`.chat-item[data-chat-id="${userId}"][data-chat-type="private"]`);
    if (existingItem) {
        existingItem.classList.add('active');
    }

    console.log(`✅ Started chat with ${userName} (${userId})`);
}

export async function updateTabBadges() {
    try {
        const response = await fetch('/Chat/GetUnreadCounts');
        if (!response.ok) return;
        const data = await response.json();
        if (!data.success) return;

        setTabBadge('all', data.totalUnread);
        setTabBadge('private', data.privateUnread);
        setTabBadge('groups', data.groupUnread);
        setTabBadge('channels', data.channelUnread);
    } catch (error) {
        console.error('❌ Update tab badges error:', error);
    }
}

function setTabBadge(tabName, count) {
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (!tabBtn) return;
    let badge = tabBtn.querySelector('.tab-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'tab-badge';
            tabBtn.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
    } else {
        if (badge) badge.remove();
    }
}



export function renderChatItem(chat) {
    const container = document.getElementById('chatList');
    if (!container) return;

    const chatEl = document.createElement('div');
    chatEl.className = `chat-item ${chat.type} ${currentChat?.id == chat.id && currentChat?.type == chat.type ? 'active' : ''}`;
    chatEl.dataset.chatId = chat.id;
    chatEl.dataset.chatType = chat.type;

    // ✅ رنگ badge بر اساس muted بودن
    const isMuted = chat.isMuted || false;
    const badgeClass = isMuted ? 'unread-badge muted' : 'unread-badge';
    const unreadBadge = chat.unreadCount > 0
        ? `<span class="${badgeClass}">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>`
        : '';

    // ✅ آیکون muted
    const mutedIcon = isMuted ? '<i class="fas fa-bell-slash muted-icon" title="بی‌صدا"></i>' : '';

    let avatarHtml = chat.avatar
        ? `<img src="${chat.avatar}" class="chat-avatar-img" alt="${escapeHtml(chat.name)}" />`
        : `<div class="chat-avatar-initials">${getInitials(chat.name)}</div>`;

    chatEl.innerHTML = `
        <div class="chat-avatar ${chat.isOnline ? 'online' : ''}">
            ${avatarHtml}
        </div>
        <div class="chat-info">
            <div class="chat-name-row">
                <span class="chat-name">${mutedIcon} ${escapeHtml(chat.name)}</span>
                ${unreadBadge}
            </div>
        </div>
    `;
    container.appendChild(chatEl);
}

export async function selectChat(chatEl) {
    console.log('🔄 Selecting chat:', chatEl.dataset.chatId);

    setLastSenderId(null);
    setMessageGroupCount(0);
    setHasMoreMessages(true);
    setIsPageFocused(true);

    document.querySelectorAll('.chat-item')?.forEach(item => item.classList.remove('active'));
    chatEl.classList.add('active');

    const chatId = parseInt(chatEl.dataset.chatId);
    const chatType = chatEl.dataset.chatType;
    const chatName = chatEl.querySelector('.chat-name')?.textContent || 'چت';

    setCurrentChat({ id: chatId, type: chatType, name: chatName });

    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = 'flex';
        inputArea.classList.add('show');
    }

    safeUpdateChatHeader(chatType, chatId, chatName);
    await loadMessages(false);

    setTimeout(async () => {
        const unreadSeparator = document.querySelector('.unread-separator');
        if (unreadSeparator) {
            unreadSeparator.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            scrollToBottom();
        }
        await markMessagesAsRead();
        await updateTabBadges();
        setTimeout(() => {
            const sep = document.querySelector('.unread-separator');
            if (sep) sep.remove();
        }, 1000);
    }, 300);
}

function safeUpdateChatHeader(chatType, chatId, chatName) {
    const chatTitleEl = document.getElementById('chatTitle');
    if (chatTitleEl) chatTitleEl.textContent = chatName;

    const chatData = chatsData.find(c => c.id === chatId);

    const chatAvatarSmall = document.querySelector('.chat-avatar-small');
    if (chatAvatarSmall && chatData) {
        chatAvatarSmall.innerHTML = chatData.avatar
            ? `<img src="${chatData.avatar}" class="chat-avatar-img-small" alt="${escapeHtml(chatName)}" />`
            : `<div class="chat-avatar-initials-small">${getInitials(chatName)}</div>`;
        chatAvatarSmall.classList.toggle('online', !!chatData.isOnline);
    }

    const callVoiceBtn = document.getElementById('callVoiceBtn');
    const callVideoBtn = document.getElementById('callVideoBtn');
    if (callVoiceBtn && callVideoBtn) {
        const showCalls = chatType === 'private';
        callVoiceBtn.style.display = showCalls ? 'flex' : 'none';
        callVideoBtn.style.display = showCalls ? 'flex' : 'none';
    }

    const manageMembersBtn = document.getElementById('manageMembersBtn');
    if (manageMembersBtn && (chatType === 'group' || chatType === 'channel')) {
        manageMembersBtn.style.display = 'flex';
        const hasPermission = chatData?.role === 'Owner' || chatData?.isAdmin;
        manageMembersBtn.disabled = false;
        manageMembersBtn.title = hasPermission ? 'مدیریت اعضا' : 'مشاهده اعضا';
        manageMembersBtn.style.opacity = '1';
        manageMembersBtn.dataset.chatId = chatId;
        manageMembersBtn.dataset.chatType = chatType;
        manageMembersBtn.dataset.isAdmin = hasPermission ? 'true' : 'false';
    } else if (manageMembersBtn) {
        manageMembersBtn.style.display = 'none';
    }



    // ✅ دکمه Mute/Unmute
    const muteBtn = document.getElementById('moreBtn');
    if (muteBtn && (chatType === 'group' || chatType === 'channel')) {
        muteBtn.style.display = 'flex';
        const isMuted = chatData?.isMuted || false;
        muteBtn.innerHTML = isMuted
            ? '<i class="fas fa-bell" title="صدادار کردن"></i>'
            : '<i class="fas fa-bell-slash" title="بی‌صدا کردن"></i>';
        muteBtn.title = isMuted ? 'صدادار کردن' : 'بی‌صدا کردن';

        // حذف listener قبلی
        const newMuteBtn = muteBtn.cloneNode(true);
        muteBtn.parentNode.replaceChild(newMuteBtn, muteBtn);

        newMuteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleMuteChat(chatId, chatType);
        });
    } else if (muteBtn && chatType === 'private') {
        muteBtn.style.display = 'none';
    }


}

function safeSetupMoreButton(chatType, chatId) {
    const moreBtn = document.getElementById('moreBtn');
    if (!moreBtn) return;
    const newMoreBtn = moreBtn.cloneNode(true);
    moreBtn.parentNode.replaceChild(newMoreBtn, moreBtn);
    newMoreBtn.style.display = 'flex';
    newMoreBtn.title = 'گزینه‌های بیشتر';
    newMoreBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
}

if (!window.chatListeners) {
    window.chatListeners = true;
    document.addEventListener('click', (e) => {
        const manageMembersBtn = document.getElementById('manageMembersBtn');
        if (manageMembersBtn && e.target === manageMembersBtn) {
            e.stopPropagation();
            if (currentChat?.type === 'group' && window.groupManager) {
                window.groupManager.showMembersDialog(currentChat.id);
            } else if (currentChat?.type === 'channel' && window.channelManager) {
                window.channelManager.showMembersDialog(currentChat.id);
            }
        }
    });
}

export function handleTabClick(tabBtn) {
    const tab = tabBtn.dataset.tab;
    document.querySelectorAll('.tab-btn')?.forEach(btn => btn.classList.remove('active'));
    tabBtn.classList.add('active');
    loadChats(tab);
}






export function getChatsData() {
    return chatsData;
}

// ✅ تب فعلی رو برگردون
export function getActiveTab() {
    const activeTabBtn = document.querySelector('.tab-btn.active');
    return activeTabBtn?.dataset.tab || 'all';
}

// ✅ بی‌صدا / صدادار کردن
async function toggleMuteChat(chatId, chatType) {
    try {
        const response = await fetch('/Chat/ToggleMute', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': getCsrfToken()
            },
            body: JSON.stringify({ chatId, chatType })
        });

        const result = await response.json();
        if (result.success) {
            // آپدیت دکمه
            const muteBtn = document.getElementById('moreBtn');
            if (muteBtn) {
                muteBtn.innerHTML = result.isMuted
                    ? '<i class="fas fa-bell" title="صدادار کردن"></i>'
                    : '<i class="fas fa-bell-slash" title="بی‌صدا کردن"></i>';
                muteBtn.title = result.isMuted ? 'صدادار کردن' : 'بی‌صدا کردن';
            }

            // ریلود لیست چت
            await loadChats(getActiveTab());

            console.log(`✅ Mute toggled: ${result.isMuted ? 'Muted' : 'Unmuted'}`);
        }
    } catch (error) {
        console.error('❌ Toggle mute error:', error);
    }
}