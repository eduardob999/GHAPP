import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import { ARTIST_BY_SONG, SONG_PROGRESSIONS } from '../domain/songs';
import { describeMissing, lockStateOf } from '../domain/curriculum';
import { chordsIn, formatChordRef } from '../domain/curriculum';
import { progressionSkillId } from '../domain/progressions';
import { useSkillStates } from '../hooks/useSkillStates';

/**
 * Songs you can play, and songs you nearly can.
 *
 * The point of the screen is the second half. A list of what you *can* play is
 * a scoreboard; a list showing that "Let It Be" is one chord away is a reason
 * to go and learn F. So every song is always visible, and a locked one names
 * the chord standing between you and it.
 *
 * The songs are ordinary progressions underneath — scored by ear, scheduled by
 * FSRS, gated by the same curriculum — so this panel only has to sort them and
 * hand one over.
 */

export interface SongsPanelProps {
  user: User;
  onPlay?: (progressionId: string) => void;
  onLearnShape?: (skillId: string) => void;
}

export function SongsPanel({ user, onPlay, onLearnShape }: SongsPanelProps) {
  const { states } = useSkillStates(user.uid);

  const stateById = useMemo(
    () => new Map(states.map((state) => [state.skillId, state])),
    [states],
  );

  const songs = useMemo(() => {
    return SONG_PROGRESSIONS.map((song) => {
      const lock = lockStateOf(song, stateById);
      const played = stateById.get(progressionSkillId(song.id));

      return { song, lock, played, chords: chordsIn(song) };
    }).sort((a, b) => {
      // Playable first, then nearly-playable by how few chords are missing.
      if (a.lock.unlocked !== b.lock.unlocked) return a.lock.unlocked ? -1 : 1;
      return a.lock.missing.length - b.lock.missing.length;
    });
  }, [stateById]);

  const playable = songs.filter((entry) => entry.lock.unlocked).length;

  return (
    <section className="card">
      <div className="card__header">
        <span className="pill" data-testid="playable-count">
          {playable} of {songs.length} playable
        </span>
      </div>

      <p className="card__body">
        Real songs, chords only. Each one is scored by ear like everything else — and the locked
        ones tell you exactly which chord is in the way.
      </p>

      <ul className="songlist" data-testid="songlist">
        {songs.map(({ song, lock, played, chords }) => (
          <li
            key={song.id}
            className={`songlist__item${lock.unlocked ? '' : ' songlist__item--locked'}`}
            data-song={song.id}
            data-locked={lock.unlocked ? 'false' : 'true'}
          >
            <div className="songlist__head">
              <span className="songlist__title">{song.title}</span>
              <span className="songlist__artist">{ARTIST_BY_SONG.get(song.id)}</span>
            </div>

            <p className="songlist__chords">
              {chords.map((chord) => formatChordRef(chord)).join(' · ')}
            </p>

            {lock.unlocked ? (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => onPlay?.(song.id)}
                data-testid="song-play"
              >
                {played ? 'Play again' : 'Play it'} →
              </button>
            ) : (
              <div className="songlist__locked">
                <span className="songlist__missing">
                  Needs {describeMissing(lock.missing)}
                </span>
                {lock.nextShape ? (
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => onLearnShape?.(lock.nextShape!.id)}
                    data-testid="song-learn"
                  >
                    Learn {lock.nextShape.title} →
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
