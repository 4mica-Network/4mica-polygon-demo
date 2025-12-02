import { useState } from 'react'
import type Player from 'video.js/dist/types/player'
import VideoPlayer from './components/VideoPlayer'
import { config } from './config/env'

function App() {
  const [playerReady, setPlayerReady] = useState<boolean>(false)

  const handlePlayerReady = (player: Player): void => {
    setPlayerReady(true)

    player.on('error', () => {
      const error = player.error()
      console.error('Video.js error:', error)
    })
  }

  return (
    <div className='min-h-screen bg-gray-900 flex items-center justify-center p-4'>
      <div className='w-full max-w-6xl'>
        <div className='mb-4'>
          <h1 className='text-2xl font-light text-gray-100 tracking-wide'>4Mica x Polygon Demo</h1>
        </div>

        <div className='bg-black rounded-lg overflow-hidden shadow-2xl'>
          <VideoPlayer src={config.playlistUrl} onReady={handlePlayerReady} />
        </div>

        {playerReady && <div className='mt-4 text-center text-gray-400 text-sm'>Player ready</div>}
      </div>
    </div>
  )
}

export default App
