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
            queue: {
              orderBy: {
                position: 'asc',
              },
            },
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

          // Additional logic and database interactions here...

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
        }
      }

      if (!track) {
        console.log(`There's no currently playing track for event: ${event.id}`);
      } else if (
        playbackState.body.progress_ms >= track.duration_ms ||
        playbackState.body.progress_ms === 0
      ) {
        console.log(`The track '${track.name}' has ended for event: ${event.id}`);

        const validQueueItems = event.playlist.queue.filter((item) => item.position >= 0);
        if (validQueueItems.length > 0) {
          const nextSong = validQueueItems[0];
          console.log(nextSong);
          await spotifyClient.play({ uris: [`spotify:track:${nextSong.trackId}`] });

          await prisma.playlist.update({
            where: { id: event.playlist.id },
            data: {
              queue: {
                update: {
                  where: { id: nextSong.id },
                  data: { position: -1 },
                },
              },
            },
          });
          console.log(`Played next song`);

          // Decrement position of the rest of the queue
          for (let i = 1; i < validQueueItems.length; i++) {
            const queueItem = validQueueItems[i];

            await prisma.playlist.update({
              where: { id: event.playlist.id },
              data: {
                queue: {
                  update: {
                    where: { id: queueItem.id },
                    data: { position: queueItem.position - 1 },
                  },
                },
              },
            });
          }
          console.log('Updated song positions in the queue');
        } else {
          console.log(`The queue is empty, no song to play.`);

          const recommendations = await spotifyClient.getRecommendations({
            seed_tracks: [track.id],
            min_energy: 0.4,
            min_popularity: 50,
            limit: 20,
          });

          if (recommendations.body.tracks.length > 0) {
            const randomIndex = Math.floor(Math.random() * recommendations.body.tracks.length);
            const randomTrack = recommendations.body.tracks[randomIndex];

            const lastRandomSongAttempt = new Date(event.last_random_song_attempt);
            const now = new Date();

            if (now.getTime() - lastRandomSongAttempt.getTime() >= 5000) {
              await spotifyClient.play({ uris: [`spotify:track:${randomTrack.id}`] });
              console.log(
                `Played a random recommended song: '${randomTrack.name}' by '${randomTrack.artists[0].name}'`,
              );

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
