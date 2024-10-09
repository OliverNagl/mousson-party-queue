const express = require('express');
const request = require('request');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser'); // Added for user tracking
const { v4: uuidv4 } = require('uuid'); // Added for generating unique user IDs

// Create an Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle all routes by sending the index.html file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Replace with your Spotify app credentials
const client_id = process.env.SPOTIFY_CLIENT_ID; // Use environment variable
const client_secret = process.env.SPOTIFY_CLIENT_SECRET; // Use environment variable
const redirect_uri = process.env.REDIRECT_URI || 'https://party-queue-57ab7486e08a.herokuapp.com/';

const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(bodyParser.json());
app.use(cookieParser()); // Use cookie-parser

// Middleware to assign userId to guests
app.use((req, res, next) => {
  if (!req.cookies.userId) {
    res.cookie('userId', uuidv4(), { httpOnly: true });
  }
  next();
});

// In-memory storage
let access_token = '';
let refresh_token = '';
let expires_in = 0;
let token_timestamp = 0;
let queue = [];
let currentTrack = null;
let isPlaying = false;
let votes = {}; // { userId: { songId: vote } } - For tracking user votes

// Scopes required
const scopes = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
];

// Generate random string for state
function generateRandomString(length) {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Authentication
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const auth_query_parameters = new URLSearchParams({
    response_type: 'code',
    client_id: client_id,
    scope: scopes.join(' '),
    redirect_uri: redirect_uri,
    state: state,
  });

  res.redirect(
    'https://accounts.spotify.com/authorize/?' +
      auth_query_parameters.toString()
  );
});

app.get('/callback', (req, res) => {
  const code = req.query.code;

  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code',
    },
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(client_id + ':' + client_secret).toString('base64'),
    },
    json: true,
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      access_token = body.access_token;
      refresh_token = body.refresh_token;
      expires_in = body.expires_in;
      token_timestamp = Date.now();

      console.log('Access token acquired:', access_token);

      res.redirect('/');
    } else {
      console.error('Authentication failed:', error || body);
      res.send('Authentication failed');
    }
  });
});

// Refresh Access Token
function refreshAccessToken(callback) {
  console.log('Refreshing access token...');
  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(client_id + ':' + client_secret).toString('base64'),
    },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
    },
    json: true,
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      access_token = body.access_token;
      expires_in = body.expires_in;
      token_timestamp = Date.now();

      console.log('Access token refreshed:', access_token);

      if (callback) callback();
    } else {
      console.error('Failed to refresh access token:', error || body);
    }
  });
}

// Check if token is expired
function isTokenExpired() {
  return Date.now() > token_timestamp + expires_in * 1000;
}

// Queue Management
app.get('/api/queue', (req, res) => {
  res.json(queue);
});

app.post('/api/queue', (req, res) => {
  const song = req.body;
  song.votes = 0;
  queue.push(song);
  updateQueue();
  res.sendStatus(200);

  // If the queue has only one song, start playing
  if (queue.length === 1 && !isPlaying) {
    playNextTrack();
  }
});

app.post('/api/vote', (req, res) => {
  const userId = req.cookies.userId;
  const { songId, vote } = req.body;

  if (!votes[userId]) {
    votes[userId] = {};
  }

  // Check if user has already voted on this song
  if (votes[userId][songId]) {
    res.status(400).send('You have already voted on this song.');
  } else {
    const song = queue.find((s) => s.id === songId);
    if (song) {
      song.votes += vote;
      votes[userId][songId] = vote;
      updateQueue();
      res.sendStatus(200);
    } else {
      res.status(404).send('Song not found.');
    }
  }
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.emit('queueUpdated', queue);

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

function updateQueue() {
  // Sort queue based on votes
  queue.sort((a, b) => b.votes - a.votes);
  io.emit('queueUpdated', queue);
}

// Playback Control
function playNextTrack() {
  if (queue.length > 0) {
    currentTrack = queue.shift();
    updateQueue();
    playTrack(currentTrack.uri);
  } else {
    currentTrack = null;
    isPlaying = false;
    console.log('Queue is empty. No track to play.');
  }
}

function playTrack(trackUri) {
  console.log('Preparing to play track:', trackUri);
  if (isTokenExpired()) {
    refreshAccessToken(() => {
      getAvailableDevicesAndPlay(trackUri);
    });
  } else {
    getAvailableDevicesAndPlay(trackUri);
  }
}

let laptopDeviceId;

function getAvailableDevicesAndPlay(trackUri) {
  getAvailableDevices((devices) => {
    // Log available devices
    console.log('Available devices:', devices);

    // Replace 'Laszlos MacBook Air' with your actual device name
    const laptopDevice = devices.find(
      (device) => device.name === 'Laszlos MacBook Air' // Replace this
    );

    if (laptopDevice) {
      laptopDeviceId = laptopDevice.id;
      console.log('Laptop device ID:', laptopDeviceId);
      sendPlayRequest(trackUri, laptopDeviceId);
    } else {
      console.error(
        'Laptop device not found. Please ensure Spotify is open on your laptop.'
      );
    }
  });
}

function sendPlayRequest(trackUri, deviceId) {
  console.log('Sending play request to device:', deviceId);
  const options = {
    url: `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    headers: { Authorization: 'Bearer ' + access_token },
    json: {
      uris: [trackUri],
    },
  };

  request.put(options, (error, response, body) => {
    if (!error) {
      if (response.statusCode === 204) {
        isPlaying = true;
        console.log('Playback started for track:', trackUri);
      } else {
        console.error(
          `Error playing track (status ${response.statusCode}):`,
          body || response.statusMessage
        );
      }
    } else {
      console.error('Error playing track:', error);
    }
  });
}

// Monitor Playback State
setInterval(() => {
  if (isPlaying && currentTrack) {
    if (isTokenExpired()) {
      refreshAccessToken(checkPlaybackState);
    } else {
      checkPlaybackState();
    }
  }
}, 5000);

function checkPlaybackState() {
  console.log('Checking playback state...');
  const options = {
    url: 'https://api.spotify.com/v1/me/player/currently-playing',
    headers: { Authorization: 'Bearer ' + access_token },
    json: true,
  };

  request.get(options, (error, response, body) => {
    if (!error && response.statusCode === 200 && body && body.item) {
      const remainingTime =
        body.item.duration_ms - body.progress_ms;
      console.log(
        `Current track progress: ${body.progress_ms} / ${body.item.duration_ms} ms`
      );
      if (remainingTime <= 5000) {
        console.log('Less than 5 seconds remaining. Playing next track.');
        playNextTrack();
      }
    } else {
      console.error('Error fetching playback state:', error || body);
    }
  });
}

// Search Endpoint
app.get('/api/search', (req, res) => {
  const query = req.query.q;

  function searchSpotify() {
    const options = {
      url: `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      headers: { Authorization: 'Bearer ' + access_token },
      json: true,
    };

    request.get(options, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        console.log('Search results:', body.tracks.items);
        res.json(body.tracks.items);
      } else {
        console.error('Error in searchSpotify:', error || body);
        res.status(response.statusCode).send(body || error);
      }
    });
  }

  if (isTokenExpired()) {
    console.log('Access token expired. Refreshing token...');
    refreshAccessToken(() => {
      searchSpotify();
    });
  } else {
    searchSpotify();
  }
});

function getAvailableDevices(callback) {
  const options = {
    url: 'https://api.spotify.com/v1/me/player/devices',
    headers: { Authorization: 'Bearer ' + access_token },
    json: true,
  };

  request.get(options, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      callback(body.devices);
    } else {
      console.error('Error fetching devices:', error || body);
      callback([]);
    }
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});