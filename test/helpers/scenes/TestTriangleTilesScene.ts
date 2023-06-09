import { Color, WebGLRenderer } from 'three'

import lib from '@lib/index'

import { getQuickKeyboardDirectionVector } from '../directionalKeyboardInputHelper'
import BaseTest2DScene from './BaseTest2DScene'

import { listenToProperty } from '../../utils/propertyListeners'
export default class TestTriangleTilesScene extends BaseTest2DScene {
  arrowKeysDirection = getQuickKeyboardDirectionVector()
  color: Color
  constructor() {
    super()

    //geo.setIndex([0, 1, 2, 0, 2, 3])
    const color = new Color(1, 1, 0.4)
    this.color = color

    const testPlane = new lib.PegboardMesh()
    testPlane.scale.multiplyScalar(1 / 2000)
    testPlane.position.x -= 0.1
    this.scene.add(testPlane)
    testPlane.updateMatrixWorld()
    testPlane.translateY(-0.06)

    const tempVal = { x: 0, y: 0, z: 0 }
    const playerCoord = testPlane.playerCoord
    listenToProperty(tempVal, 'x', (x) => {
      playerCoord.x = x
    })
    listenToProperty(tempVal, 'y', (y) => {
      playerCoord.y = y
    })
    // listenToProperty(tempVal, 'z', (z) => {
    //   playerCoord.z = z
    // })

    window.addEventListener('mousemove', (e) => {
      tempVal.x = (e.clientX / window.innerWidth) * 20 - 10
      tempVal.y = -((e.clientY / window.innerHeight) * 20 - 10)
    })
  }
  update(dt: number) {
    // const scrollOffset = this.textureCachingScroller.scrollOffset
    // const cacheResolution = this.textureCachingScroller.cacheResolution
    // const arrowKeys = this.arrowKeysDirection
    // scrollOffset.x += arrowKeys.x * dt * cacheResolution.x
    // scrollOffset.y -= arrowKeys.y * dt * cacheResolution.y
    super.update(dt)
  }

  render(renderer: WebGLRenderer, dt: number) {
    super.render(renderer, dt)
  }
}
