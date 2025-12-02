import { useEffect, useRef } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import { setupXhrOverride } from '../utils/videoJsXhrOverride'
import { handlePayment } from '../utils/paymentHandler'

interface VideoPlayerProps {
  src: string
  onReady?: (player: Player) => void
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, onReady }) => {
  const videoRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)

  useEffect(() => {
    if (!playerRef.current) {
      const videoElement = document.createElement('video-js')
      videoElement.classList.add('vjs-big-play-centered')

      videoRef.current?.appendChild(videoElement)

      const player = videojs(videoElement, {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: true,
        html5: {
          vhs: {
            overrideNative: true,
          },
        },
      })

      player.on('xhr-hooks-ready', () => {
        setupXhrOverride(handlePayment, player)
      })

      playerRef.current = player

      if (onReady) {
        onReady(player)
      }
    }
  }, [onReady])

  useEffect(() => {
    const player = playerRef.current

    if (player && src) {
      player.src({
        src: src,
        type: 'application/x-mpegURL',
      })
    }
  }, [src])

  useEffect(() => {
    const player = playerRef.current

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose()
        playerRef.current = null
      }
    }
  }, [])

  return (
    <div data-vjs-player>
      <div ref={videoRef} className='w-full' />
    </div>
  )
}

export default VideoPlayer
