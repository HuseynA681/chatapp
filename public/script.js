const socket = io();
let currentUser = null;
let currentRoom = { type: 'public' };

function setChatHeader(label) {
  document.getElementById('chatHeader').textContent = label;
}

function clearMessages() {
  document.getElementById('messages').innerHTML = '';
}

function setActiveTab(activeId) {
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.classList.toggle('active', button.id === activeId);
  });
}

function showChatPanel() {
  document.getElementById('chatPanel').style.display = 'block';
  document.getElementById('profilePanel').style.display = 'none';
  document.getElementById('publicChatBtn').textContent = 'Public';
}

function showProfilePanel() {
  document.getElementById('chatPanel').style.display = 'none';
  document.getElementById('profilePanel').style.display = 'block';
}

async function loadRoomMessages(room) {
  const params = new URLSearchParams({ type: room.type });
  if (room.type === 'dm') {
    params.set('targetId', room.targetId);
    params.set('userId', currentUser.id);
  } else if (room.type === 'group') {
    params.set('groupId', room.groupId);
  }

  const response = await fetch(`/messages?${params.toString()}`);
  if (!response.ok) return;
  const data = await response.json();
  if (Array.isArray(data.messages)) {
    data.messages.forEach(appendMessage);
  }
}

function sendChatMessage() {
  const messageInput = document.getElementById('messageInput');
  const message = messageInput.value.trim();
  if (!message || !currentUser) return;

  const payload = {
    message,
    userId: currentUser.id,
    type: currentRoom.type
  };

  if (currentRoom.type === 'dm') {
    payload.targetId = currentRoom.targetId;
  } else if (currentRoom.type === 'group') {
    payload.groupId = currentRoom.groupId;
  }

  socket.emit('sendMessage', payload);
  messageInput.value = '';
  messageInput.focus();
}

async function joinRoom(room) {
  currentRoom = room;
  setChatHeader(room.label);
  clearMessages();
  socket.emit('joinRoom', room);
  await loadRoomMessages(room);
  if (room.type === 'group') {
    await loadGroupMembers(room.groupId);
  } else {
    hideGroupControls();
  }
}

function joinPublic() {
  joinRoom({ type: 'public', label: 'Public Chat' });
  document.querySelectorAll('.sidebar-item').forEach((item) => item.classList.remove('active'));
  document.getElementById('publicChatBtn').classList.add('active');
}

async function loadUsers() {
  const response = await fetch(`/users?userId=${currentUser.id}`);
  if (!response.ok) return;
  const data = await response.json();
  const usersList = document.getElementById('usersList');
  usersList.innerHTML = '';
  data.users.forEach((user) => {
    if (user.username === currentUser.username) return;
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    const status = user.online ? 'online' : 'offline';
    item.innerHTML = `<span>${user.username} (${user.role})</span><span>${status}</span>`;

    const actionContainer = document.createElement('div');
    actionContainer.style.display = 'flex';
    actionContainer.style.gap = '6px';
    actionContainer.style.alignItems = 'center';

    const dmButton = document.createElement('button');
    dmButton.type = 'button';
    dmButton.textContent = 'DM';
    dmButton.addEventListener('click', () => {
      setActiveTab('publicChatBtn');
      joinRoom({ type: 'dm', targetId: user.id, label: `DM with ${user.username}` });
    });
    actionContainer.appendChild(dmButton);

    if (!user.isFriend) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.textContent = 'Add';
      addButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const response = await fetch('/friends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id, friendId: user.id })
        });
        if (response.ok) {
          await Promise.all([loadUsers(), loadFriends()]);
        } else {
          const data = await response.json();
          alert(data.error || 'Could not add friend');
        }
      });
      actionContainer.appendChild(addButton);
    } else {
      const friendLabel = document.createElement('span');
      friendLabel.textContent = 'Friend';
      friendLabel.style.fontSize = '12px';
      actionContainer.appendChild(friendLabel);
    }

    item.appendChild(actionContainer);
    usersList.appendChild(item);
  });
}

async function loadGroups() {
  const response = await fetch(`/groups?userId=${currentUser.id}`);
  if (!response.ok) return;
  const data = await response.json();
  const groupsList = document.getElementById('groupsList');
  groupsList.innerHTML = '';
  data.groups.forEach((group) => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = `<span>${group.name}</span><span>Group</span>`;
    item.addEventListener('click', () => {
      setActiveTab('publicChatBtn');
      joinRoom({ type: 'group', groupId: group.id, label: `Group: ${group.name}` });
    });
    groupsList.appendChild(item);
  });
}

function hideGroupControls() {
  const groupControls = document.getElementById('groupControls');
  if (groupControls) {
    groupControls.style.display = 'none';
  }
  const selector = document.getElementById('groupMemberSelect');
  if (selector) {
    selector.innerHTML = '<option value="">Select user to add</option>';
  }
  const list = document.getElementById('groupMembersList');
  if (list) {
    list.innerHTML = '';
  }
}

async function loadGroupMembers(groupId) {
  const membersResponse = await fetch(`/group-members?groupId=${groupId}`);
  if (!membersResponse.ok) return;
  const membersData = await membersResponse.json();
  const usersResponse = await fetch(`/users?userId=${currentUser.id}`);
  if (!usersResponse.ok) return;
  const usersData = await usersResponse.json();

  const members = membersData.members || [];
  const users = usersData.users || [];
  const groupMembersList = document.getElementById('groupMembersList');
  const groupControls = document.getElementById('groupControls');
  const selector = document.getElementById('groupMemberSelect');

  if (groupControls) {
    groupControls.style.display = 'block';
  }

  if (groupMembersList) {
    groupMembersList.innerHTML = '';
    members.forEach((member) => {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      item.innerHTML = `<span>${member.username} (${member.role})</span><span>Member</span>`;
      groupMembersList.appendChild(item);
    });
  }

  if (selector) {
    selector.innerHTML = '<option value="">Select user to add</option>';
    users
      .filter((user) => user.id !== currentUser.id && !members.some((member) => member.id === user.id))
      .forEach((user) => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.username} (${user.role})${user.online ? ' online' : ''}`;
        selector.appendChild(option);
      });
  }
}

async function loadFriends() {
  const response = await fetch(`/friends?userId=${currentUser.id}`);
  if (!response.ok) return;
  const data = await response.json();
  const friendsList = document.getElementById('friendsList');
  friendsList.innerHTML = '';
  data.friends.forEach((friend) => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = `<span>${friend.username} (${friend.role})</span><span>${friend.online ? 'online' : 'offline'}</span>`;
    friendsList.appendChild(item);
  });
}

async function refreshChatData() {
  await Promise.all([loadUsers(), loadGroups(), loadFriends()]);
  joinPublic();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('showRegister').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth').style.display = 'none';
    document.getElementById('register').style.display = 'block';
  });

  document.getElementById('showLogin').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register').style.display = 'none';
    document.getElementById('auth').style.display = 'block';
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
      currentUser = { id: data.userId, username: data.username, role: data.role };
      document.getElementById('auth').style.display = 'none';
      document.getElementById('chat').style.display = 'block';
      socket.emit('join', { username: data.username, role: data.role, userId: data.userId });
      document.getElementById('profileUsername').textContent = data.username;
      document.getElementById('profileRole').textContent = data.role;
      await refreshChatData();
    } else {
      alert(data.error);
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;

    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
      alert('Registration successful. Please login.');
      document.getElementById('register').style.display = 'none';
      document.getElementById('auth').style.display = 'block';
    } else {
      alert(data.error);
    }
  });

  document.getElementById('publicChatBtn').addEventListener('click', () => {
    setActiveTab('publicChatBtn');
    showChatPanel();
    joinPublic();
  });

  document.getElementById('profileTabBtn').addEventListener('click', () => {
    setActiveTab('profileTabBtn');
    showProfilePanel();
  });

  document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const groupName = document.getElementById('groupNameInput').value.trim();
    if (!groupName) return;

    const response = await fetch('/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: groupName, userId: currentUser.id })
    });

    const data = await response.json();
    if (response.ok) {
      document.getElementById('groupNameInput').value = '';
      await loadGroups();
    } else {
      alert(data.error);
    }
  });

  document.getElementById('addGroupMemberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const select = document.getElementById('groupMemberSelect');
    const memberId = select.value;
    if (!memberId || !currentRoom || currentRoom.type !== 'group') return;

    const response = await fetch('/groups/add-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: currentRoom.groupId, userId: currentUser.id, memberId: parseInt(memberId, 10) })
    });

    const data = await response.json();
    if (response.ok) {
      await loadGroupMembers(currentRoom.groupId);
    } else {
      alert(data.error || 'Unable to add member');
    }
  });

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) {
      alert('You must be logged in to change your password.');
      return;
    }

    const currentPassword = document.getElementById('currentPassword').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      alert('All password fields are required.');
      return;
    }

    if (newPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    if (currentPassword === newPassword) {
      alert('Your new password must be different from the current password.');
      return;
    }

    try {
      const response = await fetch('/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, currentPassword, newPassword })
      });

      const data = await response.json();
      if (response.ok) {
        alert(data.message);
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
      } else {
        alert(data.error || `Could not change password (${response.status})`);
      }
    } catch (error) {
      console.error('Password change failed:', error);
      alert('Unable to change password right now. Please try again later.');
    }
  });

  document.getElementById('messageForm').addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendChatMessage();
  });

  document.getElementById('sendMessageBtn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendChatMessage();
  });
});

socket.on('message', (data) => {
  appendMessage(data);
});

socket.on('reactionUpdate', (data) => {
  console.log('reactionUpdate', data);
  const messageElement = document.querySelector(`[data-message-id='${data.messageId}']`);
  if (messageElement) {
    updateReactions(messageElement, data.reactions);
  }
});

socket.on('messageDeleted', (data) => {
  const messageElement = document.querySelector(`[data-message-id='${data.messageId}']`);
  if (messageElement) {
    messageElement.remove();
  }
});

socket.on('chatCleared', (data) => {
  if (
    (data.type === 'public' && currentRoom.type === 'public') ||
    (data.type === 'dm' && currentRoom.type === 'dm' && String(data.targetId) === String(currentRoom.targetId)) ||
    (data.type === 'group' && currentRoom.type === 'group' && String(data.groupId) === String(currentRoom.groupId))
  ) {
    clearMessages();
    appendSystemMessage('Chat cleared by owner');
  }
});

socket.on('onlineUsers', async () => {
  if (currentUser) {
    await Promise.all([loadUsers(), loadFriends()]);
  }
});

function appendMessage(data) {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  if (data.id) {
    messageElement.dataset.messageId = data.id;
  }

  const roleTag = getRoleTag(data.role);
  const header = document.createElement('div');
  header.innerHTML = `${roleTag} <strong>${escapeHtml(data.username)}</strong>: ${escapeHtml(data.message)}`;
  messageElement.appendChild(header);

  if (data.id) {
    const reactions = data.reactions || {};
    const reactionBar = createReactionBar(data.id, reactions);
    messageElement.appendChild(reactionBar);

    if (currentUser && (data.userId === currentUser.id || currentUser.role === 'owner')) {
      const controls = document.createElement('div');
      controls.className = 'message-controls';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', async () => {
        const response = await fetch('/messages/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUser.id, messageId: data.id })
        });
        if (!response.ok) {
          const result = await response.json();
          alert(result.error || 'Could not delete message');
        }
      });
      controls.appendChild(deleteButton);
      messageElement.appendChild(controls);
    }
  }

  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
}

function createReactionBar(messageId, reactions) {
  const container = document.createElement('div');
  container.className = 'reaction-bar';

  const reactionTypes = [
    { name: 'heart', emoji: '❤️' },
    { name: 'thumbsup', emoji: '👍' },
    { name: 'laugh', emoji: '😂' }
  ];
  const userReaction = reactions && reactions.users ? reactions.users[currentUser?.username] : null;

  reactionTypes.forEach((reaction) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reaction-button';
    button.dataset.reaction = reaction.name;
    button.dataset.messageId = messageId;
    button.title = `React ${reaction.name}`;
    const count = reactions && reactions.counts ? reactions.counts[reaction.name] || 0 : 0;
    button.innerHTML = `${reaction.emoji} <span class="reaction-count">${count}</span>`;
    if (reaction.name === userReaction) {
      button.classList.add('active-reaction');
    }
    button.addEventListener('click', () => {
      socket.emit('reactMessage', { messageId, reaction: reaction.name });
    });
    container.appendChild(button);
  });

  return container;
}

function updateReactions(messageElement, reactions) {
  const buttons = messageElement.querySelectorAll('.reaction-button');
  const userReaction = reactions && reactions.users ? reactions.users[currentUser?.username] : null;
  buttons.forEach((button) => {
    const reactionName = button.dataset.reaction;
    const count = reactions && reactions.counts ? reactions.counts[reactionName] || 0 : 0;
    const emoji = reactionName === 'heart' ? '❤️' : reactionName === 'thumbsup' ? '👍' : '😂';
    button.innerHTML = `${emoji} <span class="reaction-count">${count}</span>`;
    button.classList.toggle('active-reaction', reactionName === userReaction);
  });
}

function getRoleTag(role) {
  const colors = { owner: 'red', 'co-owner': 'blue', user: 'yellow' };
  return `<span style="color: ${colors[role] || 'black'}">[${role.toUpperCase()}]</span>`;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function appendSystemMessage(text) {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'userJoined';
  messageElement.textContent = text;
  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
}

socket.on('userJoined', (data) => {
  const messages = document.getElementById('messages');
  const messageElement = document.createElement('div');
  messageElement.className = 'userJoined';
  const roleTag = getRoleTag(data.role);
  messageElement.innerHTML = `${roleTag} ${escapeHtml(data.username)} joined the chat`;
  messages.appendChild(messageElement);
});

socket.on('roleUpdate', (data) => {
  if (data.username === currentUser.username) {
    currentUser.role = data.newRole;
  }
});