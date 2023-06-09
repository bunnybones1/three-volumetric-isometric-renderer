import { BufferGeometry } from 'three'
import NamedBitsInBytes from '../../../helpers/utils/NamedBitsInBytes'
import NamedBitsInNumber from '../../../helpers/utils/NamedBitsInNumber'
import { wrap } from '../../../utils/math'

import SpriteMaker from './SpriteMaker'

type BottomAndTopIds = {
  idTop: number
  idBottom: number
}
const masks32: number[] = []
for (let i = 0; i < 32; i++) {
  masks32[i] = 1 << i
}
const __animFrameTimes = ['0', '1', '2', '3', '4', '5', '6', '7'] as const

const metaSpriteStrings = [
  'body',
  'body2',
  'hat',
  'sword',
  'shield',
  'itemLog',
  'sheep',
  'skeleton',
  'wheelBarrow',
  'animRun',
  'animTime1',
  'animTime2',
  'animTime4'
] as const
type MetaSprite = typeof metaSpriteStrings[number]

const visualSpriteStrings = [
  'layer2',
  'body',
  'body2',
  'hat',
  'sword',
  'shield',
  'itemLog',
  'sheep',
  'sheepRun0',
  'sheepRun1',
  'sheepRun2',
  'sheepRun3',
  'sheepRun4',
  'sheepRun5',
  'sheepRun6',
  'sheepRun7',
  'skeleton',
  'skeletonRun0',
  'skeletonRun1',
  'skeletonRun2',
  'skeletonRun3',
  'skeletonRun4',
  'skeletonRun5',
  'skeletonRun6',
  'skeletonRun7',
  'wheelBarrow',
  'wheelBarrowRun0',
  'wheelBarrowRun1',
  'wheelBarrowRun2',
  'wheelBarrowRun3',
  'wheelBarrowRun4',
  'wheelBarrowRun5',
  'wheelBarrowRun6',
  'wheelBarrowRun7'
] as const

type VisSprite = typeof visualSpriteStrings[number]

const masks8: number[] = []
for (let i = 0; i < 8; i++) {
  masks8[i] = 1 << i
}

export class SpriteController {
  private _animTime: number
  get animTime(): number {
    return this._animTime
  }
  set animTime(value: number) {
    if (value === 0) {
      this.metaBytes.disableBit('animRun')
    } else {
      this.metaBytes.enableBit('animRun')
    }
    this._animTime = value
    this.animFrame = ~~(value * 8)
  }
  private _animFrame: number
  get animFrame(): number {
    return this._animFrame
  }
  set animFrame(value: number) {
    if (value === this._animFrame) {
      return
    }
    this._animFrame = value
    if ((this.animFrame & 1) !== 0) {
      this.metaBytes.enableBit('animTime1')
    } else {
      this.metaBytes.disableBit('animTime1')
    }
    if ((this.animFrame & 2) !== 0) {
      this.metaBytes.enableBit('animTime2')
    } else {
      this.metaBytes.disableBit('animTime2')
    }
    if ((this.animFrame & 4) !== 0) {
      this.metaBytes.enableBit('animTime4')
    } else {
      this.metaBytes.disableBit('animTime4')
    }
  }
  z = 0
  constructor(
    public x: number,
    public y: number,
    public id: number,
    public angle: number,
    public metaBytes: NamedBitsInNumber<typeof metaSpriteStrings>
  ) {
    //
  }
}

let __id = 0
export default class JITSpriteSampler {
  private _sprites: SpriteController[] = []
  offsetX = 0
  offsetY = 0
  makeSprite(x: number, y: number, angle: number) {
    const id = __id
    // const sprite = new SpriteController(x, y, id, angle)
    const meta = this.getMeta(id)
    const sprite = new SpriteController(x, y, id, angle, meta)
    __id++
    this._sprites.push(sprite)
    return sprite
  }
  get spriteMaker(): SpriteMaker {
    return this._spriteMaker
  }
  set spriteMaker(value: SpriteMaker) {
    throw new Error('Cannot change spriteMaker during runtime')
  }
  bytesPerTile: number
  metaCache: Map<string, NamedBitsInNumber<typeof metaSpriteStrings>> =
    new Map() //maybe change this caching mechanism for something more memory friendly. e.i. Map<number, <Map<number, number>> ?
  constructor(
    private _spriteMaker: SpriteMaker,
    private _pixelsPerTile: number,
    private _viewWidth: number,
    private _viewHeight: number
  ) {
    this.bytesPerTile = Math.ceil(visualSpriteStrings.length / 8)
  }

  getMeta(id: number) {
    const key = id.toString()
    if (this.metaCache.has(key)) {
      return this.metaCache.get(key)!
    }
    const metaProps = new NamedBitsInNumber(0, metaSpriteStrings)
    this.validateMeta(metaProps)
    console.log('valid', metaProps.has('sheep'))
    this.metaCache.set(key, metaProps)
    return metaProps
  }
  validateMeta(val: NamedBitsInNumber<typeof metaSpriteStrings>) {
    // if (!val.has('body') && !val.has('body2')) {
    //   val.enableBit('body')
    // }
    if (val.has('body') && val.has('body2')) {
      val.disableBit('body2')
    }
    if (val.has('sheep') || val.has('skeleton')) {
      val.disableBit('body2')
      val.disableBit('body')
      val.enableBit('animRun')
    } else if (val.has('animRun')) {
      val.disableBit('animRun')
    }
    if (val.has('sheep')) {
      val.disableBit('skeleton')
    }

    return val
  }
  sampleVisProps(metaProps: NamedBitsInNumber<typeof metaSpriteStrings>) {
    const visProps = new NamedBitsInBytes(
      new Uint8Array(this.bytesPerTile),
      visualSpriteStrings
    )

    function getSuffix() {
      let suffix = ''
      if (metaProps.has('animRun')) {
        const time =
          (metaProps.has('animTime1') ? 1 : 0) +
          (metaProps.has('animTime2') ? 2 : 0) +
          (metaProps.has('animTime4') ? 4 : 0)
        suffix = 'Run' + time
      }
      return suffix
    }

    if (metaProps.has('sheep')) {
      //@ts-ignore
      visProps.enableBit('sheep' + getSuffix())
    } else if (metaProps.has('skeleton')) {
      //@ts-ignore
      visProps.enableBit('skeleton' + getSuffix())
    } else if (metaProps.has('wheelBarrow')) {
      //@ts-ignore
      visProps.enableBit('wheelBarrow' + getSuffix())
    } else {
      if (metaProps.has('body')) {
        visProps.enableBit('body')
      }
      if (metaProps.has('body2')) {
        visProps.enableBit('body2')
      }

      if (metaProps.has('hat')) {
        visProps.enableBit('hat')
      }
      if (metaProps.has('sword')) {
        visProps.enableBit('sword')
      }
      if (metaProps.has('shield')) {
        visProps.enableBit('shield')
      }
      if (metaProps.has('itemLog')) {
        visProps.enableBit('itemLog')
      }
    }
    return visProps
  }

  sampleVisIds(
    sprite: SpriteController,
    time: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' = '0'
  ) {
    const visProps = this.sampleVisProps(sprite.metaBytes)
    const bottomAndTopIds: BottomAndTopIds = this.sampleVisIdsByVisProps(
      visProps,
      sprite.angle
    )
    return bottomAndTopIds
  }

  sampleVisIdsByVisProps(
    visProps: NamedBitsInBytes<typeof visualSpriteStrings>,
    angle: number
  ) {
    const idBottom = this._spriteMaker.getTileIdAtAngle(visProps.bytes, angle)
    const visProps2 = visProps.bytes.slice()
    visProps2[0] |= 1
    const idTop = this._spriteMaker.getTileIdAtAngle(visProps2, angle)

    const bottomAndTopIds: BottomAndTopIds = {
      idBottom,
      idTop
    }
    return bottomAndTopIds
  }
  updateVis(bottomPointsGeo: BufferGeometry, topPointsGeo: BufferGeometry) {
    if (this._sprites.length > 0) {
      const ppt = this._pixelsPerTile
      const xyzBottomAttr = bottomPointsGeo.getAttribute('xyz')
      const xyzBottomArr = xyzBottomAttr.array as number[]
      const idBottomAttr = bottomPointsGeo.getAttribute('id')
      const idBottomArr = idBottomAttr.array as number[]
      const xyzTopAttr = topPointsGeo.getAttribute('xyz')
      const xyzTopArr = xyzTopAttr.array as number[]
      const idTopAttr = topPointsGeo.getAttribute('id')
      const idTopArr = idTopAttr.array as number[]
      bottomPointsGeo.drawRange.count = 0
      topPointsGeo.drawRange.count = 0
      let j = 0
      for (let i = 0; i < this._sprites.length; i++) {
        const sprite = this._sprites[i]
        const currentFrame =
          __animFrameTimes[sprite.animFrame % __animFrameTimes.length]
        const x = sprite.x - this.offsetX
        const y = sprite.y - this.offsetY
        const z = sprite.z
        if (x < 0 || x > this._viewWidth || y < 0 || y > this._viewHeight) {
          continue
        }
        const xSnap = Math.round(wrap(x, 0, this._viewWidth) * ppt) / ppt
        const ySnap = Math.round(wrap(y, 0, this._viewHeight) * ppt) / ppt
        const zSnap = Math.round(z * ppt) / ppt
        const j3 = j * 3
        xyzBottomArr[j3] = xSnap
        xyzBottomArr[j3 + 1] = ySnap
        xyzBottomArr[j3 + 2] = zSnap
        xyzTopArr[j3] = xSnap
        xyzTopArr[j3 + 1] = ySnap + 1
        xyzTopArr[j3 + 2] = zSnap
        const frame = sprite.metaBytes.has('animRun') ? currentFrame : undefined
        const sample = this.sampleVisIds(sprite, frame)
        idBottomArr[j] = sample.idBottom
        idTopArr[j] = sample.idTop
        j++
      }
      bottomPointsGeo.drawRange.count = j
      topPointsGeo.drawRange.count = j
      if (j === 0) {
        return false
      }
      xyzBottomAttr.needsUpdate = true
      idBottomAttr.needsUpdate = true
      xyzTopAttr.needsUpdate = true
      idTopAttr.needsUpdate = true
      return true
    } else {
      return false
    }
  }
}
