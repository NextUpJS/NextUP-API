const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();
const { getSpotifyClient, spotifyApiContainer } = require('../middleware/spotify');

router.get('/:name', async (req, res) => {
  const hostName = req.params.name;

  try {
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (host) {
      const events = await prisma.event.findMany({
        where: { hostId: host.id },
        include: { host: true, playlist: { include: { songs: true } } },
      });

      if (events.length > 0) {
        res.json(events);
      } else {
        res.status(404).json({ error: 'No events found for this host' });
      }
    } else {
      res.status(404).json({ error: 'Host not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:name/pause', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.pause();

    console.log('Playback paused successfully');
    return res.send('Playback paused successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/now-playing', getSpotifyClient, async (req, res) => {
  try {
    const data = await req.spotifyClient.getMyCurrentPlaybackState();

    if (data.body && data.body.is_playing) {
      res.json(data.body.item);
    } else {
      res.json({ message: 'User is not playing anything, or playback is paused.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/resume', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.play();

    console.log('Playback resumed successfully');
    return res.send('Playback resumed successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/playlist', async (req, res) => {
  const hostName = req.params.name;

  const host = await prisma.user.findUnique({
    where: { name: hostName },
  });

  if (!host) {
    return res.status(404).json({ error: 'Host not found' });
  }

  const event = await prisma.event.findFirst({
    where: { hostId: host.id },
    include: { playlist: true },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found for this host' });
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: event.playlistId },
    include: { songs: true },
  });

  res.json({ playlist });
});

router.post('/:name/songs', getSpotifyClient, async (req, res) => {
  try {
    const { songID } = req.body;
    const hostName = req.params.name;

    // First, find the host associated with the name
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    // Then, find the event associated with the host
    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: event.playlistId },
      include: { songs: true },
    });

    const song = await prisma.song.create({
      data: {
        songId: songID,
        playlistId: playlist.id,
      },
    });

    console.log('Song added successfully');
    return res.status(200).json({ message: 'Song added successfully', song });
  } catch (error) {
    console.error('An error occurred while adding the song:', error);
    return res.status(500).send('An error occurred while adding the song');
  }
});

router.get('/:name/tracks/:id', getSpotifyClient, async (req, res) => {
  const trackId = req.params.id;

  try {
    const data = await req.spotifyClient.getTrack(trackId);

    if (data.body) {
      res.json(data.body);
    } else {
      res.status(404).json({ message: 'Track not found.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

module.exports = router;
