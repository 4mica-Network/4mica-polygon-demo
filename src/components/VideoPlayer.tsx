import { useCallback, useEffect, useMemo, useRef } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import { PaymentEvents, setupXhrOverride } from '../utils/videoJsXhrOverride'

interface VideoPlayerProps {
  src: string
  onReady?: (player: Player) => void
  paymentHandler: (
    response: any,
    options: any,
    body?: any,
    onAmountReady?: (amountDisplay: string) => void
  ) => Promise<{ header: string; amountDisplay: string; txHash?: string }>
  paymentEvents?: PaymentEvents
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, onReady, paymentHandler, paymentEvents }) => {
  const videoRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const paymentHandlerRef = useRef(paymentHandler)
  const paymentEventsRef = useRef(paymentEvents)

  useEffect(() => {
    paymentHandlerRef.current = paymentHandler
  }, [paymentHandler])

  useEffect(() => {
    paymentEventsRef.current = paymentEvents
  }, [paymentEvents])

  const paymentHandlerProxy = useCallback(
    (response: any, options: any, body?: any, onAmountReady?: (amountDisplay: string) => void) =>
      paymentHandlerRef.current(response, options, body, onAmountReady),
    []
  )

  const paymentEventsProxy = useMemo(
    () => ({
      onPaymentRequested: (chunkId: string, amount?: string) =>
        paymentEventsRef.current?.onPaymentRequested?.(chunkId, amount),
      onPaymentSettled: (chunkId: string, amount?: string, txHash?: string) =>
        paymentEventsRef.current?.onPaymentSettled?.(chunkId, amount, txHash),
      onPaymentFailed: (chunkId: string, error: unknown, amount?: string) =>
        paymentEventsRef.current?.onPaymentFailed?.(chunkId, error, amount),
    }),
    []
  )

  useEffect(() => {
    if (!playerRef.current) {
      const videoElement = document.createElement('video-js')
      videoElement.classList.add('vjs-big-play-centered')

      videoRef.current?.appendChild(videoElement)

      const player = videojs(videoElement, {
        controls: true,
        autoplay: false,
        preload: 'none',
        fluid: true,
        html5: {
          vhs: {
            overrideNative: true,
          },
        },
      })

      player.on('xhr-hooks-ready', () => {
        setupXhrOverride(paymentHandlerProxy, player, paymentEventsProxy)
      })

      playerRef.current = player

      if (onReady) {
        onReady(player)
      }
    }
  }, [onReady, paymentHandlerProxy, paymentEventsProxy])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return

    player.pause()
    player.reset()

    if (src) {
      player.src({
        src,
        type: 'application/x-mpegURL',
      })
      // preload remains 'none', but having the source attached ensures the play button is clickable
      player.pause()
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
