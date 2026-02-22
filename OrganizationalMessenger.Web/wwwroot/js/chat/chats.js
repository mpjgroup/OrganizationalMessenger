// ========================================
// Chat List Management - کامل و تست شده
// ========================================

import { currentChat, setCurrentChat, setLastSenderId, setMessageGroupCount, setHasMoreMessages, setIsPageFocused } from './variables.js';
import { loadMessages, markMessagesAsRead, removeUnreadSeparator } from './messages.js';
import { escapeHtml, formatPersianTime, getInitials, scrollToBottom } from './utils.js';
import { toggleMessageInput } from './init.js';

let chatsData = []; // Global chats data

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
        chatsData.forEach(chat => renderChatItem(chat));
        console.log('✅ Chat list rendered');

        // ✅ آپدیت شمارنده تب‌ها بعد از هر بار لود
        await updateTabBadges();
    } catch (error) {
        console.error('❌ Load chats error:', error);
    }
}

// ✅ تابع جدید: آپدیت badge روی تب‌ها
export async function updateTabBadges() {
    try {
        const response = await fetch('/Chat/GetUnreadCounts');
        if (!response.ok) return;

        const data = await response.json();
        if (!data.success) return;

        console.log('📊 Unread counts:', data);

        // آپدیت هر تب
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

    // حذف badge قبلی
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
    chatEl.className = `chat-item ${chat.type} ${currentChat?.id == chat.id ? 'active' : ''}`;
    chatEl.dataset.chatId = chat.id;
    chatEl.dataset.chatType = chat.type;

    const unreadBadge = chat.unreadCount > 0
        ? `<span class="unread-badge">${chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>`
        : '';

    let avatarHtml = '';
    if (chat.avatar) {
        avatarHtml = `<img src="${chat.avatar}" class="chat-avatar-img" alt="${escapeHtml(chat.name)}" />`;
    } else {
        avatarHtml = `<div class="chat-avatar-initials">${getInitials(chat.name)}</div>`;
    }

    chatEl.innerHTML = `
        <div class="chat-avatar ${chat.isOnline ? 'online' : ''}">
            ${avatarHtml}
        </div>
        <div class="chat-info">
            <div class="chat-name-row">
                <span class="chat-name">${escapeHtml(chat.name)}</span>
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

    setCurrentChat({
        id: chatId,
        type: chatType,
        name: chatName
    });

    // Input area
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = 'flex';
        inputArea.classList.add('show');
    }

    safeUpdateChatHeader(chatType, chatId, chatName);
    await loadMessages(false);

    // Scroll و Mark as read
    setTimeout(async () => {
        const unreadSeparator = document.querySelector('.unread-separator');
        if (unreadSeparator) {
            unreadSeparator.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            scrollToBottom();
        }

        await markMessagesAsRead();

        // ✅ آپدیت تب‌ها بعد از mark as read
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

    // ✅ پیدا کردن اطلاعات کامل چت از chatsData
    const chatData = chatsData.find(c => c.id === chatId);

    // ✅ آپدیت آواتار در هدر
    const chatAvatarSmall = document.querySelector('.chat-avatar-small');
    if (chatAvatarSmall && chatData) {
        if (chatData.avatar) {
            chatAvatarSmall.innerHTML = `<img src="${chatData.avatar}" class="chat-avatar-img-small" alt="${escapeHtml(chatName)}" />`;
        } else {
            chatAvatarSmall.innerHTML = `<div class="chat-avatar-initials-small">${getInitials(chatName)}</div>`;
        }

        if (chatData.isOnline) {
            chatAvatarSmall.classList.add('online');
        } else {
            chatAvatarSmall.classList.remove('online');
        }
    }

    // Call buttons
    const callVoiceBtn = document.getElementById('callVoiceBtn');
    const callVideoBtn = document.getElementById('callVideoBtn');
    if (callVoiceBtn && callVideoBtn) {
        const showCalls = chatType === 'private';
        callVoiceBtn.style.display = showCalls ? 'flex' : 'none';
        callVideoBtn.style.display = showCalls ? 'flex' : 'none';
    }

    // مدیریت اعضا
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

// Global event listener برای manageMembersBtn
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

    document.querySelectorAll('.tab-btn')?.forEach(btn => {
        btn.classList.remove('active');
    });
    tabBtn.classList.add('active');

    loadChats(tab);
}

export function getChatsData() {
    return chatsData;
}