import { useCallback, useEffect, useMemo, useRef } from 'react'
import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'
import 'video.js/dist/video-js.css'
import { PaymentEvents, setupXhrOverride } from '../utils/videoJsXhrOverride'
import type { PaymentTabInfo } from '../utils/paymentHandler'

interface VideoPlayerProps {
  src: string
  onReady?: (player: Player) => void
  paymentHandler: (
    response: any,
    options: any,
    body?: any,
    onAmountReady?: (amountDisplay: string) => void
  ) => Promise<{ header: string; amountDisplay: string; txHash?: string; tabInfo?: PaymentTabInfo }>
  paymentEvents?: PaymentEvents
}

// Target ~1 segment ahead.
const SINGLE_SEGMENT_SECONDS = 3

// --- GLOBAL VHS CONFIG (must run before any player is created) ---

// Video.js 7/8 expose VHS as videojs.Vhs (older builds might use videojs.Hls)
const Vhs = (videojs as any).Vhs || (videojs as any).Hls

if (Vhs) {
  Vhs.GOAL_BUFFER_LENGTH = SINGLE_SEGMENT_SECONDS
  Vhs.MAX_GOAL_BUFFER_LENGTH = SINGLE_SEGMENT_SECONDS
  Vhs.GOAL_BUFFER_LENGTH_RATE = 0

  Vhs.BUFFER_LOW_WATER_LINE = 0
  Vhs.BUFFER_LOW_WATER_LINE_RATE = 0
  Vhs.MAX_BUFFER_LOW_WATER_LINE = SINGLE_SEGMENT_SECONDS

  Vhs.BUFFER_HIGH_WATER_LINE = SINGLE_SEGMENT_SECONDS
}

// Optional: extra enforcement via internal controller/loaders.
// Not strictly required once the global config is set, but harmless.
const enforceSingleSegmentBuffering = (player?: Player | null) => {
  if (!player?.tech) return

  const tech = player.tech({ IWillNotUseThisInPlugins: true } as any)
  const vhs = (tech as any)?.vhs
  const controller = vhs?.masterPlaylistController_

  if (!controller) return

  const goal = () => SINGLE_SEGMENT_SECONDS

  controller.goalBufferLength = goal
  controller.bufferLowWaterLine = goal

  const setLoaderGoal = (loader?: any) => {
    if (loader) {
      loader.goalBufferLength_ = goal
    }
  }

  setLoaderGoal(controller.mainSegmentLoader_)
  setLoaderGoal(controller.audioSegmentLoader_)
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
        enforceSingleSegmentBuffering(player)
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
