require('dotenv').config();
const CronJob = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({});
const SpotifyWebApi = require('spotify-web-api-node');

exports.initScheduledJobs = () => {
  const scheduledJobFunction = CronJob.schedule(process.env.CRON_TIME, async () => {
    const events = await prisma.event.findMany({
      include: {
        playlist: {
          include: {
            queue: true,
          },
        },
        host: true,
      },
    });

    const spotifyClient = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_SECRET_ID,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    });

    for (const event of events) {
      const now = new Date();
      const lastPlayed = new Date(event.last_queue_item_added);
      const differenceInMinutes = (now - lastPlayed) / 1000 / 60;

      if (differenceInMinutes > 60) {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            active: false,
          },
        });
        console.log(
          `Event ${event.id} has been inactive for more than 60 minutes. Set active to false.`,
        );
        continue;
      }

      spotifyClient.setAccessToken(event.host.spotify_token);

      const playbackState = await spotifyClient.getMyCurrentPlaybackState();
      const track = playbackState.body.item;

      if (track) {
        try {
          const currentEvent = await prisma.event.findUnique({ where: { id: event.id } });
          // Update the currently playing track in the event

          // Check if the track and artist exist in the database
          let trackInDb = await prisma.track.findUnique({ where: { id: track.id } });
          let artistInDb = await prisma.artist.findUnique({ where: { id: track.artists[0].id } });
          let albumInDb = await prisma.album.findUnique({ where: { id: track.album.id } });

          // If the artist doesn't exist, add it
          if (!artistInDb && track.artists[0]) {
            artistInDb = await prisma.artist.create({
              data: {
                id: track.artists[0].id,
                name: track.artists[0].name,
                href: track.artists[0].href,
                spotifyUrl: track.artists[0].external_urls.spotify,
                uri: track.artists[0].uri,
                artistType: track.artists[0].type,
              },
            });
            console.log(`Added artist '${artistInDb.name}' to the database.`);
          }

          if (!albumInDb) {
            albumInDb = await prisma.album.create({
              data: {
                id: track.album.id,
                albumType: track.album.album_type,
                externalSpotifyUrl: track.album.external_urls.spotify,
                href: track.album.href,
                name: track.album.name,
                releaseDate: track.album.release_date,
                releaseDatePrecision: track.album.release_date_precision,
                totalTracks: track.album.total_tracks,
                uri: track.album.uri,
                // Add other album properties if necessary
                Artist: {
                  connect: { id: track.artists[0].id }, // Connect the album to its artist
                },
              },
            });
            console.log(`Added album '${albumInDb.name}' to the database.`);
          }

          // If the track doesn't exist, add it
          if (!trackInDb) {
            trackInDb = await prisma.track.create({
              data: {
                id: track.id,
                name: track.name,
                discNumber: track.disc_number,
                durationMs: track.duration_ms,
                explicit: track.explicit,
                isrc: track.external_ids.isrc,
                externalUrl: track.external_urls.spotify,
                href: track.href,
                isLocal: track.is_local,
                popularity: track.popularity,
                previewUrl: track.preview_url,
                trackNumber: track.track_number,
                trackType: track.type,
                uri: track.uri,
                albumId: track.album.id,
                artistId: track.artists[0].id,
                // Add other track properties if necessary
              },
            });
            console.log(`Added track '${trackInDb.name}' to the database.`);
          }

          if (currentEvent.playingTrackId !== track.id) {
            await prisma.event.update({
              where: { id: event.id },
              data: {
                playingTrackId: track.id,
              },
            });
            console.log(`Updated playingTrackId to '${track.id}' for event: ${event.id}`);
          }
        } catch (error) {
          console.error('Error occurred:', error);
          // You can log the error to a file or a centralized logging system
          // for better error tracking and debugging.
        }
      }

      if (!track) {
        console.log(`There's no currently playing track for event: ${event.id}`);
      } else if (
        playbackState.body.progress_ms >= track.duration_ms ||
        playbackState.body.progress_ms === 0
      ) {
        console.log(`The track '${track.name}' has ended for event: ${event.id}`);

        // if the queue is not empty, play the next song in the queue
        const songsWithPosition = event.playlist.queue.filter((song) => song.position > 0);
        if (songsWithPosition.length > 0) {
          const nextSong = songsWithPosition[0];

          if (!nextSong) {
            console.log(
              'No songs in the queue with a positive position. Continuing to play a random song.',
            );
          } else {
            console.log(nextSong);
            await spotifyClient.play({ uris: [`spotify:track:${nextSong.trackId}`] });
            console.log(`Played next song`);
          }

          // decrement positions of all songs in the queue
          for (const song of event.playlist.queue) {
            await prisma.queue.update({
              where: { id: song.id },
              data: {
                position: song.position - 1,
              },
            });
          }
        } else {
          console.log(`The queue is empty, no song to play.`);

          // Get recommendations based on the last played song
          const recommendations = await spotifyClient.getRecommendations({
            seed_tracks: [track.id],
            min_energy: 0.4,
            min_popularity: 50,
            limit: 20,
          });

          if (recommendations.body.tracks.length > 0) {
            // Select a random track from the recommendations
            const randomIndex = Math.floor(Math.random() * recommendations.body.tracks.length);
            const randomTrack = recommendations.body.tracks[randomIndex];

            // Retrieve the last_random_song_attempt for the event
            const lastRandomSongAttempt = new Date(event.last_random_song_attempt);
            const now = new Date();

            // Check if at least 5 seconds have passed since the last attempt
            if (now.getTime() - lastRandomSongAttempt.getTime() >= 5000) {
              // Play the selected random track
              await spotifyClient.play({ uris: [`spotify:track:${randomTrack.id}`] });
              console.log(
                `Played a random recommended song: '${randomTrack.name}' by '${randomTrack.artists[0].name}'`,
              );

              // Update the last_random_song_attempt in the event
              await prisma.event.update({
                where: { id: event.id },
                data: { last_random_song_attempt: now },
              });
            } else {
              console.log(
                `Less than 5 seconds have passed since the last attempt. Not playing a new song.`,
              );
            }
          } else {
            console.log(`No recommended tracks found.`);
          }
        }
      } else {
        console.log(`The track '${track.name}' is still playing for event: ${event.id}`);
      }
    }
  });

  scheduledJobFunction.start();
};
