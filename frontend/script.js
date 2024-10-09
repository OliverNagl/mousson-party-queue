// frontend/script.js

const socket = io();

// Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResultsDiv = document.getElementById('search-results');
const queueDiv = document.getElementById('queue');

// Event Listeners
searchBtn.addEventListener('click', searchTracks);

// Socket.io events
socket.on('queueUpdated', (queue) => {
  displayQueue(queue);
});

// Functions

let userVotes = {}; // { songId: true } - Track songs the user has voted on

function searchTracks() {
  const query = searchInput.value;
  fetch(`/api/search?q=${encodeURIComponent(query)}`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(tracks => {
      displaySearchResults(tracks);
    })
    .catch(error => {
      console.error('Error fetching search results:', error);
      alert('Error fetching search results. Please try again.');
    });
}

function displaySearchResults(tracks) {
  searchResultsDiv.innerHTML = '';
  tracks.forEach(track => {
    const trackDiv = document.createElement('div');
    trackDiv.className = 'song-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'song-info';
    infoDiv.innerText = `${track.name} by ${track.artists[0].name}`;

    const addButton = document.createElement('button');
    addButton.innerText = 'Add to Queue';
    addButton.onclick = () => addToQueue(track);

    trackDiv.appendChild(infoDiv);
    trackDiv.appendChild(addButton);
    searchResultsDiv.appendChild(trackDiv);
  });
}

function addToQueue(track) {
  const song = {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artist: track.artists[0].name,
    votes: 0
  };

  fetch('/api/queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(song)
  });
}

function displayQueue(queue) {
  queueDiv.innerHTML = '';
  queue.forEach((song) => {
    const songDiv = document.createElement('div');
    songDiv.className = 'song-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'song-info';
    infoDiv.innerText = `${song.name} by ${song.artist} - Votes: ${song.votes}`;

    const voteDiv = document.createElement('div');
    voteDiv.className = 'vote-buttons';

    const upvoteBtn = document.createElement('button');
    upvoteBtn.innerText = 'Upvote';
    upvoteBtn.disabled = userVotes[song.id]; // Disable if already voted
    upvoteBtn.onclick = () => voteSong(song.id, 1, upvoteBtn, downvoteBtn);

    const downvoteBtn = document.createElement('button');
    downvoteBtn.innerText = 'Downvote';
    downvoteBtn.disabled = userVotes[song.id]; // Disable if already voted
    downvoteBtn.onclick = () => voteSong(song.id, -1, upvoteBtn, downvoteBtn);

    voteDiv.appendChild(upvoteBtn);
    voteDiv.appendChild(downvoteBtn);

    songDiv.appendChild(infoDiv);
    songDiv.appendChild(voteDiv);
    queueDiv.appendChild(songDiv);
  });
}

function voteSong(songId, vote, upvoteBtn, downvoteBtn) {
  if (userVotes[songId]) {
    alert('You have already voted on this song.');
    return;
  }

  fetch('/api/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ songId, vote })
  })
    .then(response => {
      if (response.ok) {
        userVotes[songId] = true;
        upvoteBtn.disabled = true;
        downvoteBtn.disabled = true;
      } else {
        return response.text().then(text => {
          alert(text);
        });
      }
    })
    .catch(error => {
      console.error('Error voting on song:', error);
    });
}