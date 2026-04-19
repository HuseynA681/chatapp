const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// MySQL connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST || 'mysql5045.site4now.net',
  user: process.env.DB_USER || 'ac838c_dbhus',
  password: process.env.DB_PASSWORD || 'Azerbaijan1918',
  database: process.env.DB_NAME || 'db_ac838c_dbhus',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000,
  keepAliveInitialDelay: 0
});

console.log('Connected to MySQL');

// Handle pool errors
db.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

const onlineUsers = new Map();

async function ensureSchema() {
  try {
    const columns = [
      { name: 'type', query: "ALTER TABLE messages ADD COLUMN type ENUM('public','dm','group') DEFAULT 'public'" },
      { name: 'recipient_id', query: 'ALTER TABLE messages ADD COLUMN recipient_id INT NULL' },
      { name: 'group_id', query: 'ALTER TABLE messages ADD COLUMN group_id INT NULL' },
      { name: 'reactions', query: "ALTER TABLE messages ADD COLUMN reactions JSON DEFAULT (JSON_OBJECT())" }
    ];

    for (const col of columns) {
      const [rows] = await db.promise().query(`SHOW COLUMNS FROM messages LIKE '${col.name}'`);
      if (rows.length === 0) {
        await db.promise().query(col.query);
      }
    }

    await db.promise().query(`CREATE TABLE IF NOT EXISTS chat_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`);

    await db.promise().query(`CREATE TABLE IF NOT EXISTS group_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      user_id INT NOT NULL,
      UNIQUE KEY unique_membership (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.promise().query(`CREATE TABLE IF NOT EXISTS friends (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      friend_id INT NOT NULL,
      status ENUM('accepted','pending') DEFAULT 'accepted',
      UNIQUE KEY unique_friendship (user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    console.log('Schema verified');
  } catch (err) {
    console.error('Schema initialization error:', err);
  }
}

ensureSchema();

// Register endpoint
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Check if user exists
    const [rows] = await db.promise().query('SELECT id FROM users WHERE username = ?', [username]);
    if (rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const role = username === 'Huseyn' ? 'owner' : 'user';
    const [result] = await db.promise().query('INSERT INTO users (username, role) VALUES (?, ?)', [username, role]);
    const userId = result.insertId;

    // Insert password
    await db.promise().query('INSERT INTO passwords (user_id, password) VALUES (?, ?)', [userId, hashedPassword]);

    res.json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // Get user
    const [rows] = await db.promise().query('SELECT u.id, u.role, p.password FROM users u JOIN passwords p ON u.id = p.user_id WHERE u.username = ?', [username]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'User not found. Please register first.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    res.json({ message: 'Login successful', userId: user.id, username, role: user.role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/users', async (req, res) => {
  const userId = req.query.userId;
  try {
    const [rows] = await db.promise().query('SELECT id, username, role FROM users ORDER BY username');
    let friendIds = [];

    if (userId) {
      const [friendRows] = await db.promise().query('SELECT friend_id FROM friends WHERE user_id = ? AND status = ?', [userId, 'accepted']);
      friendIds = friendRows.map((row) => row.friend_id);
    }

    const users = rows.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      online: onlineUsers.has(user.username),
      isFriend: friendIds.includes(user.id)
    }));

    res.json({ users });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/friends', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const [rows] = await db.promise().query(
      `SELECT u.id, u.username, u.role FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = 'accepted'
       ORDER BY u.username`,
      [userId]
    );
    const friends = rows.map((friend) => ({
      ...friend,
      online: onlineUsers.has(friend.username)
    }));
    res.json({ friends });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/friends', async (req, res) => {
  const { userId, friendId } = req.body;
  if (!userId || !friendId) {
    return res.status(400).json({ error: 'userId and friendId required' });
  }
  if (userId === friendId) {
    return res.status(400).json({ error: 'Cannot friend yourself' });
  }

  try {
    await db.promise().query('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)', [userId, friendId, 'accepted']);
    await db.promise().query('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)', [friendId, userId, 'accepted']);
    res.json({ message: 'Friend added' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/profile/change-password', async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  console.log('change-password request', { userId, currentPassword: currentPassword ? '***' : null, newPassword: newPassword ? '***' : null });
  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'userId, currentPassword, and newPassword required' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }

  try {
    const [rows] = await db.promise().query('SELECT password FROM passwords WHERE user_id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    const isValid = await bcrypt.compare(currentPassword, rows[0].password);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.promise().query('UPDATE passwords SET password = ? WHERE user_id = ?', [hashedPassword, userId]);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('change-password error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/groups', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const [rows] = await db.promise().query(
      `SELECT g.id, g.name FROM chat_groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ?`,
      [userId]
    );
    res.json({ groups: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/groups', async (req, res) => {
  const { name, userId } = req.body;
  if (!name || !userId) {
    return res.status(400).json({ error: 'Name and userId required' });
  }

  try {
    const [result] = await db.promise().query('INSERT INTO chat_groups (name, created_by) VALUES (?, ?)', [name, userId]);
    await db.promise().query('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [result.insertId, userId]);
    res.json({ id: result.insertId, name });
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Group name already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/group-members', async (req, res) => {
  const groupId = req.query.groupId;
  if (!groupId) {
    return res.status(400).json({ error: 'groupId required' });
  }

  try {
    const [rows] = await db.promise().query(
      `SELECT u.id, u.username, u.role
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY u.username`,
      [groupId]
    );
    res.json({ members: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/groups/add-member', async (req, res) => {
  const { groupId, userId, memberId } = req.body;
  if (!groupId || !userId || !memberId) {
    return res.status(400).json({ error: 'groupId, userId, and memberId required' });
  }

  try {
    const [membershipCheck] = await db.promise().query(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );
    if (membershipCheck.length === 0) {
      return res.status(403).json({ error: 'You must be a group member to add users' });
    }

    const [groupCheck] = await db.promise().query('SELECT id FROM chat_groups WHERE id = ?', [groupId]);
    if (groupCheck.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const [userCheck] = await db.promise().query('SELECT id FROM users WHERE id = ?', [memberId]);
    if (userCheck.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.promise().query(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id',
      [groupId, memberId]
    );
    res.json({ message: 'Member added to group' });
  } catch (error) {
    console.error(error);
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
      return res.status(400).json({ error: 'Invalid group or user ID' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/messages', async (req, res) => {
  const type = req.query.type;
  const userId = req.query.userId;
  const targetId = req.query.targetId;
  const groupId = req.query.groupId;

  try {
    let rows;
    if (type === 'public') {
      [rows] = await db.promise().query(
        `SELECT m.id, m.user_id AS userId, u.username, u.role, m.message, m.reactions, m.type, m.created_at
         FROM messages m
         JOIN users u ON m.user_id = u.id
         WHERE m.type = 'public'
         ORDER BY m.created_at ASC
         LIMIT 200`
      );
    } else if (type === 'dm' && userId && targetId) {
      [rows] = await db.promise().query(
        `SELECT m.id, m.user_id AS userId, u.username, u.role, m.message, m.reactions, m.type, m.created_at
         FROM messages m
         JOIN users u ON m.user_id = u.id
         WHERE m.type = 'dm' AND ((m.user_id = ? AND m.recipient_id = ?) OR (m.user_id = ? AND m.recipient_id = ?))
         ORDER BY m.created_at ASC`,
        [userId, targetId, targetId, userId]
      );
    } else if (type === 'group' && groupId) {
      [rows] = await db.promise().query(
        `SELECT m.id, m.user_id AS userId, u.username, u.role, m.message, m.reactions, m.type, m.created_at
         FROM messages m
         JOIN users u ON m.user_id = u.id
         WHERE m.type = 'group' AND m.group_id = ?
         ORDER BY m.created_at ASC`,
        [groupId]
      );
    } else {
      return res.status(400).json({ error: 'Invalid message request' });
    }

    rows = rows.map((row) => ({
      ...row,
      reactions: row.reactions ? (typeof row.reactions === 'string' ? JSON.parse(row.reactions) : row.reactions) : { counts: {}, users: {} }
    }));
    res.json({ messages: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.io for chat
function getDmRoom(userId1, userId2) {
  const ids = [parseInt(userId1, 10), parseInt(userId2, 10)].sort((a, b) => a - b);
  return `dm:${ids[0]}:${ids[1]}`;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (data) => {
    socket.username = data.username;
    socket.userId = data.userId;
    socket.role = data.role;
    onlineUsers.set(data.username, socket.id);
    socket.join('public');
    io.to('public').emit('userJoined', { username: data.username, role: data.role });
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));
  });

  socket.on('joinRoom', (data) => {
    if (data.type === 'public') {
      socket.join('public');
    } else if (data.type === 'dm' && data.targetId) {
      const room = getDmRoom(socket.userId, data.targetId);
      socket.join(room);
    } else if (data.type === 'group' && data.groupId) {
      socket.join(`group:${data.groupId}`);
    }
  });

  socket.on('sendMessage', async (data) => {
    const { message, userId, type = 'public', targetId, groupId } = data;
    let finalMessage = message;
    let isCommand = false;

    if (message.startsWith('/')) {
      const parts = message.split(' ');
      const command = parts[0];
      const targetUsername = parts[1];

      if ((command === '/promote' || command === '/demote') && targetUsername) {
        if (socket.role === 'owner' || socket.role === 'co-owner') {
          try {
            const [rows] = await db.promise().query('SELECT id, role FROM users WHERE username = ?', [targetUsername]);
            if (rows.length > 0) {
              const target = rows[0];
              let newRole = target.role;

              if (command === '/promote') {
                if (socket.role === 'owner') {
                  if (target.role === 'user') newRole = 'co-owner';
                  else if (target.role === 'co-owner') newRole = 'owner';
                } else if (socket.role === 'co-owner' && target.role === 'user') {
                  newRole = 'co-owner';
                }
              } else if (command === '/demote') {
                if (socket.role === 'owner') {
                  if (target.role === 'co-owner') newRole = 'user';
                  else if (target.role === 'owner') newRole = 'co-owner';
                } else if (socket.role === 'co-owner' && target.role === 'co-owner') {
                  newRole = 'user';
                }
              }

              if (newRole !== target.role) {
                await db.promise().query('UPDATE users SET role = ? WHERE id = ?', [newRole, target.id]);
                finalMessage = `${socket.username} ${command.slice(1)}d ${targetUsername} to ${newRole}`;
                isCommand = true;
                for (let [id, sock] of io.sockets.sockets) {
                  if (sock.username === targetUsername) {
                    sock.role = newRole;
                  }
                }
                io.to('public').emit('roleUpdate', { username: targetUsername, newRole });
              } else {
                finalMessage = `Cannot ${command.slice(1)} ${targetUsername}`;
                isCommand = true;
              }
            } else {
              finalMessage = `User ${targetUsername} not found`;
              isCommand = true;
            }
          } catch (error) {
            console.error(error);
            finalMessage = 'Command failed';
            isCommand = true;
          }
        } else {
          finalMessage = 'You do not have permission to use this command';
          isCommand = true;
        }
      }
    }

    try {
      if (message === '/cc') {
        if (socket.role !== 'owner') {
          finalMessage = 'You do not have permission to use this command';
          isCommand = true;
        } else {
          if (type === 'public') {
            await db.promise().query("DELETE FROM messages WHERE type = 'public'");
            io.to('public').emit('chatCleared', { type: 'public' });
          } else if (type === 'dm' && targetId) {
            await db.promise().query(
              `DELETE FROM messages WHERE type = 'dm' AND ((user_id = ? AND recipient_id = ?) OR (user_id = ? AND recipient_id = ?))`,
              [userId, targetId, targetId, userId]
            );
            const room = getDmRoom(userId, targetId);
            io.to(room).emit('chatCleared', { type: 'dm', targetId });
          } else if (type === 'group' && groupId) {
            await db.promise().query('DELETE FROM messages WHERE type = ? AND group_id = ?', [type, groupId]);
            io.to(`group:${groupId}`).emit('chatCleared', { type: 'group', groupId });
          }
          return;
        }
      }

      const [result] = await db.promise().query(
        'INSERT INTO messages (user_id, message, reactions, type, recipient_id, group_id) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, finalMessage, JSON.stringify({ counts: {}, users: {} }), type, type === 'dm' ? targetId : null, type === 'group' ? groupId : null]
      );
      const messageId = result.insertId;
      const payload = {
        id: messageId,
        userId,
        username: socket.username,
        message: finalMessage,
        role: socket.role,
        reactions: { counts: {}, users: {} },
        isCommand,
        type,
        targetId,
        groupId
      };

      if (type === 'dm' && targetId) {
        const room = getDmRoom(userId, targetId);
        io.to(room).emit('message', payload);
      } else if (type === 'group' && groupId) {
        io.to(`group:${groupId}`).emit('message', payload);
      } else {
        io.to('public').emit('message', payload);
      }
    } catch (error) {
      console.error(error);
    }
  });

  socket.on('reactMessage', async (data) => {
    const { messageId, reaction } = data;
    const username = socket.username;
    console.log('reactMessage', data, 'from', username);
    try {
      const [rows] = await db.promise().query('SELECT reactions FROM messages WHERE id = ?', [messageId]);
      if (rows.length === 0) return;

      let reactions = rows[0].reactions;
      if (!reactions) {
        reactions = { counts: {}, users: {} };
      } else if (typeof reactions === 'string') {
        reactions = JSON.parse(reactions);
      }

      if (!reactions.counts) reactions.counts = {};
      if (!reactions.users) reactions.users = {};

      const previousReaction = reactions.users[username];
      if (previousReaction === reaction) {
        delete reactions.users[username];
        reactions.counts[reaction] = Math.max((reactions.counts[reaction] || 1) - 1, 0);
      } else {
        if (previousReaction) {
          reactions.counts[previousReaction] = Math.max((reactions.counts[previousReaction] || 1) - 1, 0);
        }
        reactions.users[username] = reaction;
        reactions.counts[reaction] = (reactions.counts[reaction] || 0) + 1;
      }

      await db.promise().query('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), messageId]);
      io.emit('reactionUpdate', { messageId, reactions });
    } catch (error) {
      console.error(error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('onlineUsers', Array.from(onlineUsers.keys()));
      io.to('public').emit('userLeft', { username: socket.username, role: socket.role });
    }
  });
});

app.post('/messages/delete', async (req, res) => {
  const { userId, messageId } = req.body;
  if (!userId || !messageId) {
    return res.status(400).json({ error: 'userId and messageId required' });
  }

  try {
    const [rows] = await db.promise().query('SELECT m.user_id, m.type, m.recipient_id, m.group_id FROM messages m WHERE m.id = ?', [messageId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const message = rows[0];

    const [userRows] = await db.promise().query('SELECT role FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    const userRole = userRows[0].role;
    if (message.user_id !== userId && userRole !== 'owner') {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }

    await db.promise().query('DELETE FROM messages WHERE id = ?', [messageId]);

    if (message.type === 'public') {
      io.to('public').emit('messageDeleted', { messageId });
    } else if (message.type === 'dm') {
      const room = getDmRoom(message.user_id, message.recipient_id);
      io.to(room).emit('messageDeleted', { messageId });
    } else if (message.type === 'group' && message.group_id) {
      io.to(`group:${message.group_id}`).emit('messageDeleted', { messageId });
    }

    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});