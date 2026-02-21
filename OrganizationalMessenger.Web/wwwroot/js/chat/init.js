import { setConnection, setIsPageFocused, currentChat } from './variables.js';
import { setupSignalR } from './signalr.js';
import { markMessagesAsRead, removeUnreadSeparator, loadMessageSettings } from './messages.js';
import { setupScrollListener } from './message-handlers.js';
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

export function toggleMessageInput(show) {
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = show ? 'flex' : 'none';
    }
}