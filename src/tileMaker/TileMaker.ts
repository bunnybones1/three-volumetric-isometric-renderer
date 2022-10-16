import {
  BackSide,
  BoxBufferGeometry,
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  LinearEncoding,
  Mesh,
  MeshDepthMaterial,
  NearestFilter,
  Object3D,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  TorusKnotBufferGeometry,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three'
import FibonacciSphereGeometry from '../geometries/FibonacciSphereGeometry'
import GrassGeometry from '../geometries/GrassGeometry'
import PyramidGeometry from '../geometries/PyramidGeometry'
import {
  changeMeshMaterials,
  getMeshMaterial,
  MaterialPassType
} from '../helpers/materials/materialLib'
import { getChamferedBoxGeometry } from '../utils/geometry'
import { assertPowerOfTwo } from '../utils/math'
import { detRandRocks, detRandWoodPlanks } from '../utils/random'
import { makeRocks } from '../meshes/factoryRocks'
import { makeRockCrumbs } from '../meshes/factoryRockCrumbs'
import {
  makeTreePine,
  makeTreePineMature,
  makeTreePineStump,
  makeTreePineStumpMature
} from '../meshes/factoryTreePine'
import {
  makeTreeMaple,
  makeTreeMapleMature,
  makeTreeMapleStump,
  makeTreeMapleStumpMature
} from '../meshes/factoryTreeMaple'
import { makeGoldPile } from '../meshes/factoryGoldPile'
import { makeLampPost } from '../meshes/factoryLampPost'
import { verticalScale } from '../constants'
import { BushProps, makeRecursiveBush } from '../meshes/factoryBush'
import { memoize } from '../utils/memoizer'
import { makeBrickWall } from '../meshes/factoryBrickWall'

export default class TileMaker {
  public get passes(): MaterialPassType[] {
    return this._passes
  }
  public set passes(value: MaterialPassType[]) {
    throw new Error('You cannot change passes during runtime.')
    // this._passes = value
  }
  private _renderQueue: number[] = []
  private _tileRegistry: Uint8Array[] = []
  private _tileHashRegistry: string[] = []
  private _scene = new Scene()
  private _cameraTiltedBottom = new OrthographicCamera(
    -16,
    16,
    (0 * 32 + 16) * verticalScale,
    (0 * 32 - 16) * verticalScale,
    0,
    64
  )
  private _cameraTiltedTop = new OrthographicCamera(
    -16,
    16,
    (1 * 32 + 16) * verticalScale,
    (1 * 32 - 16) * verticalScale,
    0,
    64
  )
  private _cameraTopDown = new OrthographicCamera(-16, 16, 16, -16, -64, 64)
  private _renderTargets: Map<MaterialPassType, WebGLRenderTarget> = new Map()
  private _tileTexNeedsUpdate = true
  private _indexedMeshesVisibility: boolean[]
  private _indexedMeshes: (() => Object3D)[]
  private _tilesPerEdge: number
  private _maxTiles: number
  constructor(
    private _pixelsPerTile = 32,
    pixelsPerCacheEdge = 2048,
    private _passes: MaterialPassType[] = ['beauty']
  ) {
    assertPowerOfTwo(_pixelsPerTile)
    assertPowerOfTwo(pixelsPerCacheEdge)
    this._tilesPerEdge = pixelsPerCacheEdge / _pixelsPerTile
    this._maxTiles = Math.pow(this._tilesPerEdge, 2)
    for (const pass of _passes) {
      this._renderTargets.set(
        pass,
        new WebGLRenderTarget(pixelsPerCacheEdge, pixelsPerCacheEdge, {
          minFilter: NearestFilter,
          magFilter: NearestFilter,
          encoding: LinearEncoding,
          generateMipmaps: false
        })
      )
    }
    console.log('performance.now', performance.now())

    const scene = this._scene

    scene.autoUpdate = false
    this._cameraTiltedBottom.rotateX(Math.PI * -0.25)
    this._cameraTiltedBottom.position.set(0, 32, 32)
    scene.add(this._cameraTiltedBottom)
    this._cameraTiltedTop.rotateX(Math.PI * -0.25)
    this._cameraTiltedTop.position.set(0, 32, 32)
    scene.add(this._cameraTiltedTop)
    this._cameraTopDown.rotateX(Math.PI * -0.5)
    this._cameraTopDown.position.set(0, 0, 0)
    scene.add(this._cameraTopDown)
    const ambient = new HemisphereLight(
      new Color(0.4, 0.6, 0.9),
      new Color(0.6, 0.25, 0)
    )
    scene.add(ambient)
    const light = new DirectionalLight(new Color(1, 0.9, 0.7), 1)
    light.position.set(-0.25, 1, 0.25).normalize()
    scene.add(light)

    const brickMat = getMeshMaterial('brick')
    const mortarMat = getMeshMaterial('mortar')
    const drywallMat = getMeshMaterial('drywall')
    const floorMat = getMeshMaterial('floor')
    const groundMat = getMeshMaterial('ground')
    const ballMat = getMeshMaterial('plastic')
    const grassMat = getMeshMaterial('grass')
    const rocksMat = getMeshMaterial('rock')
    const bushMat = getMeshMaterial('bush')
    const berryMat = getMeshMaterial('berry')
    const woodMat = getMeshMaterial('wood')
    const ball = new Mesh(new SphereGeometry(16, 32, 16), ballMat)
    ball.scale.y = Math.SQRT1_2
    // ball.position.y = Math.SQRT1_2 * 14

    const floor = () => {
      const floorBoard = new Mesh(
        getChamferedBoxGeometry(8, 4, 32, 1),
        floorMat
      )
      const floorBoardPair = new Object3D()
      floorBoardPair.add(floorBoard)
      const floorBoard2 = floorBoard.clone()
      floorBoardPair.add(floorBoard2)
      floorBoard.position.z = -16
      floorBoard2.position.z = 16
      const floor = new Mesh(new BoxBufferGeometry(32, 2, 32), floorMat)
      detRandWoodPlanks()
      for (let i = 0; i < 4; i++) {
        const c = floorBoardPair.clone()
        c.position.x = i * 8 - 12
        c.position.z = ~~detRandWoodPlanks(-14, 14)
        floor.add(c)
      }
      floor.position.y = -1
      return floor
    }

    const ground = () => {
      const obj = new Mesh(new BoxBufferGeometry(32, 2, 32), groundMat)
      obj.position.y = -1
      return obj
    }

    //brick walls

    const drywall = new Mesh(new BoxBufferGeometry(32, 32, 2), drywallMat)
    const getBrickWall = memoize(() =>
      makeBrickWall(brickMat, mortarMat, -1, 1)
    )
    const brickWallSectionSC = memoize(() => {
      const obj = getBrickWall().clone()
      obj.position.z = 8
      obj.position.x = 0
      return obj
    })
    const brickWallSectionEC = memoize(() => {
      const obj = getBrickWall().clone()
      obj.position.x = 8
      obj.rotation.y = Math.PI * 0.5
      return obj
    })
    const brickWallSectionNC = memoize(() => {
      const obj = getBrickWall().clone()
      obj.position.z = -8
      obj.rotation.y = Math.PI
      return obj
    })
    const brickWallSectionWC = memoize(() => {
      const obj = getBrickWall().clone()
      obj.position.x = -8
      obj.rotation.y = Math.PI * -0.5
      return obj
    })
    const moveRelX = (brickWall: Object3D, amt: number) => {
      brickWall.position.x += Math.cos(brickWall.rotation.y) * amt
      brickWall.position.z += Math.sin(brickWall.rotation.y) * amt
    }
    // const makeBrickWallSectionsLR = (brickWallC: Object3D) => {
    //   const brickWallL = brickWallC.clone(true)
    //   const brickWallR = brickWallC.clone(true)

    //   moveRelX(brickWallL, -16)
    //   moveRelX(brickWallR, 16)
    //   return { brickWallL, brickWallR }
    // }
    const makeBrickWallSectionsL = (brickWallC: Object3D) => {
      brickWallC.updateMatrixWorld()
      const brickWallL = brickWallC.clone(true)
      moveRelX(brickWallL, -16)
      return brickWallL
    }
    const makeBrickWallSectionsR = (brickWallC: Object3D) => {
      const brickWallR = brickWallC.clone(true)
      moveRelX(brickWallR, 16)
      return brickWallR
    }
    const brickWallSectionSL = () =>
      makeBrickWallSectionsL(brickWallSectionSC())
    const brickWallSectionSR = () =>
      makeBrickWallSectionsR(brickWallSectionSC())
    const brickWallSectionWL = () =>
      makeBrickWallSectionsL(brickWallSectionWC())
    const brickWallSectionWR = () =>
      makeBrickWallSectionsR(brickWallSectionWC())
    const brickWallSectionNL = () =>
      makeBrickWallSectionsL(brickWallSectionNC())
    const brickWallSectionNR = () =>
      makeBrickWallSectionsR(brickWallSectionNC())
    const brickWallSectionEL = () =>
      makeBrickWallSectionsL(brickWallSectionEC())
    const brickWallSectionER = () =>
      makeBrickWallSectionsR(brickWallSectionEC())

    //wooden beams, struts and studs

    const woodBeamGeo = getChamferedBoxGeometry(6, 32, 6, 1)
    const beamCenter = () => {
      const beamCenter = new Mesh(woodBeamGeo, woodMat)
      beamCenter.position.y = 16
      return beamCenter
    }

    const makeStud = memoize(() => {
      const woodStudGeo = getChamferedBoxGeometry(4, 32 - 6, 6, 1)
      const stud = new Mesh(woodStudGeo, woodMat)
      stud.position.y = 16
      return stud
    })
    const makeBeamFullSectionEW = () => {
      const woodPlateGeo = getChamferedBoxGeometry(36, 3, 6, 1)
      const bottomPlate = new Mesh(woodPlateGeo, woodMat)
      bottomPlate.position.y = 1.5
      const topPlate = new Mesh(woodPlateGeo, woodMat)
      topPlate.position.y = 32 - 1.5
      const beamFullSectionEW = new Object3D()
      beamFullSectionEW.add(bottomPlate)
      beamFullSectionEW.add(topPlate)
      const stud = makeStud().clone()
      beamFullSectionEW.add(stud)
      const stud2 = stud.clone()
      stud2.position.x -= 16
      beamFullSectionEW.add(stud2)
      const stud3 = stud.clone()
      stud3.position.x += 16
      beamFullSectionEW.add(stud3)
      return beamFullSectionEW
    }
    const beamFullSectionEW = makeBeamFullSectionEW

    const beamFullSectionNS = () => {
      const obj = beamFullSectionEW().clone(true)
      obj.rotation.y = Math.PI * 0.5
      return obj
    }

    const makeShortBeam = memoize(() => {
      const woodPlateShortGeo = getChamferedBoxGeometry(15, 3, 6, 1)
      const bottomShortPlate = new Mesh(woodPlateShortGeo, woodMat)
      bottomShortPlate.position.x = 1
      bottomShortPlate.position.y = 1.5
      const topShortPlate = new Mesh(woodPlateShortGeo, woodMat)
      topShortPlate.position.x = 1
      topShortPlate.position.y = 32 - 1.5
      const shortBeam = new Object3D()
      shortBeam.add(topShortPlate)
      shortBeam.add(bottomShortPlate)
      const stud4 = makeStud().clone()
      stud4.position.x = -4.5
      const stud5 = makeStud().clone()
      stud5.position.x = 6.5
      shortBeam.add(stud4)
      shortBeam.add(stud5)
      shortBeam.position.x = 16 - 13 * 0.5
      return shortBeam
    })
    const beamE = () => {
      const obj = new Object3D()
      obj.add(makeShortBeam().clone())
      return obj
    }
    const beamS = () => {
      const obj = new Object3D()
      obj.add(makeShortBeam().clone())
      obj.rotation.y = Math.PI * 0.5
      return obj
    }
    const beamW = () => {
      const obj = new Object3D()
      obj.add(makeShortBeam().clone())
      obj.rotation.y = Math.PI
      return obj
    }
    const beamN = () => {
      const obj = new Object3D()
      obj.add(makeShortBeam().clone())
      obj.rotation.y = Math.PI * -0.5
      return obj
    }

    // brick.rotation.y = Math.PI * 0.25
    drywall.position.y = 16
    drywall.position.z = -4
    // ball.position.y = 14
    // this._camera.position.y = 16
    // this._camera.rotateY(Math.PI * -0.25)
    // pivot.add(drywall)
    // scene.add(ball)

    const grassGeoA = memoize(() => new GrassGeometry())
    const grassGeoH = memoize(() => new GrassGeometry())
    const grassGeoV = memoize(() => new GrassGeometry())
    const grassGeoCorner = memoize(() => new GrassGeometry())
    //grass
    const grassC = () => new Mesh(grassGeoA(), grassMat)
    const grassN = () => {
      const obj = new Mesh(grassGeoV(), grassMat)
      obj.position.set(0, 0, 16)
      return obj
    }
    const grassNE = () => {
      const obj = new Mesh(grassGeoCorner(), grassMat)
      obj.position.set(16, 0, 16)
      return obj
    }
    const grassE = () => {
      const obj = new Mesh(grassGeoH(), grassMat)
      obj.position.set(16, 0, 0)
      return obj
    }
    const grassSE = () => {
      const obj = new Mesh(grassGeoCorner(), grassMat)
      obj.position.set(16, 0, -16)
      return obj
    }
    const grassS = () => {
      const obj = new Mesh(grassGeoV(), grassMat)
      obj.position.set(0, 0, -16)
      return obj
    }
    const grassSW = () => {
      const obj = new Mesh(grassGeoCorner(), grassMat)
      obj.position.set(-16, 0, -16)
      return obj
    }
    const grassW = () => {
      const obj = new Mesh(grassGeoH(), grassMat)
      obj.position.set(-16, 0, 0)
      return obj
    }
    const grassNW = () => {
      const obj = new Mesh(grassGeoCorner(), grassMat)
      obj.position.set(-16, 0, 16)
      return obj
    }

    const bushC = () => makeRecursiveBush(bushMat, berryMat)
    const bushVProto = memoize(() => makeRecursiveBush(bushMat, berryMat))
    const bushHProto = memoize(() => makeRecursiveBush(bushMat, berryMat))
    const bushCornerProto = memoize(() =>
      makeRecursiveBush(bushMat, berryMat, new BushProps(16, 8, 24, 60, 22))
    )
    const bushN = () => {
      const obj = bushVProto().clone(true)
      obj.position.set(0, 0, 16)
      return obj
    }
    const bushNE = () => {
      const obj = bushCornerProto().clone(true)
      obj.position.set(16, 0, 16)
      return obj
    }
    const bushE = () => {
      const obj = bushHProto().clone(true)
      obj.position.set(16, 0, 0)
      return obj
    }
    const bushSE = () => {
      const obj = bushNE().clone(true)
      obj.position.set(16, 0, -16)
      return obj
    }
    const bushS = () => {
      const obj = bushN().clone(true)
      obj.position.set(0, 0, -16)
      return obj
    }
    const bushSW = () => {
      const obj = bushNE().clone(true)
      obj.position.set(-16, 0, -16)
      return obj
    }
    const bushW = () => {
      const obj = bushHProto().clone(true)
      obj.position.set(-16, 0, 0)
      return obj
    }
    const bushNW = () => {
      const obj = bushNE().clone(true)
      obj.position.set(-16, 0, 16)
      return obj
    }

    const goldMat = getMeshMaterial('gold')
    const goldChunkGeo = new FibonacciSphereGeometry(4, 17)
    const goldPile = () => makeGoldPile(goldChunkGeo, goldMat)

    const ironBlackMat = getMeshMaterial('ironBlack')

    const lampPost = () => makeLampPost(ironBlackMat)

    const testObject = () => {
      const obj = new Mesh(
        new TorusKnotBufferGeometry(10, 2, 48, 8),
        getMeshMaterial('plastic')
      )
      obj.position.y = 12
      obj.rotation.x = Math.PI * 0.5
      obj.scale.y *= verticalScale
      return obj
    }

    const pyramid = () => {
      const pyramidGeo = new PyramidGeometry()
      const obj = new Mesh(pyramidGeo, getMeshMaterial('floor'))
      const pyramidTop = new Mesh(pyramidGeo, getMeshMaterial('gold'))
      obj.add(pyramidTop)
      pyramidTop.scale.setScalar(0.2)
      pyramidTop.position.y = 0.82
      obj.scale.set(30, 16, 30)
      return obj
    }

    const rockyGround = () => {
      const pyramidGeo = new PyramidGeometry()
      const rockyGroundProto = new Mesh(pyramidGeo, getMeshMaterial('ground'))
      const obj = new Object3D()
      for (let i = 0; i < 12; i++) {
        const rocky = rockyGroundProto.clone()
        obj.add(rocky)
        rocky.scale.set(
          detRandRocks(3, 10),
          detRandRocks(0.25, 0.5),
          detRandRocks(3, 10)
        )
        rocky.rotation.y = detRandRocks(0, Math.PI * 2)
        rocky.position.set(detRandRocks(-12, 12), 0, detRandRocks(-12, 12))
      }
      return obj
    }

    const rocksA = memoize(() => makeRocks(rocksMat, 0))
    const rocksABig = memoize(() => makeRocks(rocksMat, 0))
    const rocksH = memoize(() => makeRocks(rocksMat, 4))
    const rocksV = memoize(() => makeRocks(rocksMat, 4))
    const rocksCorner = memoize(() => makeRocks(rocksMat, 8))
    //rocks

    const rocksC = () => rocksA()
    const rocksN = () => {
      const obj = rocksV().clone()
      obj.position.set(0, 0, 16)
      return obj
    }
    const rocksNE = () => {
      const obj = rocksCorner().clone()
      obj.position.set(16, 0, 16)
      return obj
    }
    const rocksE = () => {
      const obj = rocksH().clone()
      obj.position.set(16, 0, 0)
      return obj
    }
    const rocksSE = () => {
      const obj = rocksCorner().clone()
      obj.position.set(16, 0, -16)
      return obj
    }
    const rocksS = () => {
      const obj = rocksV().clone()
      obj.position.set(0, 0, -16)
      return obj
    }
    const rocksSW = () => {
      const obj = rocksCorner().clone()
      obj.position.set(-16, 0, -16)
      return obj
    }
    const rocksW = () => {
      const obj = rocksH().clone()
      obj.position.set(-16, 0, 0)
      return obj
    }
    const rocksNW = () => {
      const obj = rocksCorner().clone()
      obj.position.set(-16, 0, 16)
      return obj
    }
    const rocksCBig = () => {
      const obj = rocksABig().clone()
      obj.position.y += 12
      return obj
    }

    const goldOreForRocks = () => makeRocks(goldMat, 0, 2)
    const goldOreForBigRocks = () => makeRocks(goldMat, 10, 2)

    const rockCrumbsA = memoize(() => makeRockCrumbs(rocksMat))
    const rockCrumbsH = memoize(() => makeRockCrumbs(rocksMat))
    const rockCrumbsV = memoize(() => makeRockCrumbs(rocksMat))
    const rockCrumbsCorner = memoize(() => makeRockCrumbs(rocksMat))
    //rockCrumbs

    const rockCrumbsC = () => {
      const obj = rockCrumbsA().clone()
      return obj
    }
    const rockCrumbsN = () => {
      const obj = rockCrumbsV().clone()
      obj.position.set(0, 0, 16)
      return obj
    }
    const rockCrumbsNE = () => {
      const obj = rockCrumbsCorner().clone()
      obj.position.set(16, 0, 16)
      return obj
    }
    const rockCrumbsE = () => {
      const obj = rockCrumbsH().clone()
      obj.position.set(16, 0, 0)
      return obj
    }
    const rockCrumbsSE = () => {
      const obj = rockCrumbsCorner().clone()
      obj.position.set(16, 0, -16)
      return obj
    }
    const rockCrumbsS = () => {
      const obj = rockCrumbsV().clone()
      obj.position.set(0, 0, -16)
      return obj
    }
    const rockCrumbsSW = () => {
      const obj = rockCrumbsCorner().clone()
      obj.position.set(-16, 0, -16)
      return obj
    }
    const rockCrumbsW = () => {
      const obj = rockCrumbsH().clone()
      obj.position.set(-16, 0, 0)
      return obj
    }
    const rockCrumbsNW = () => {
      const obj = rockCrumbsCorner().clone()
      obj.position.set(-16, 0, 16)
      return obj
    }

    const zLimiter = new Mesh(
      new BoxGeometry(32, 32, 32),
      new MeshDepthMaterial({ side: BackSide, colorWrite: false })
    )
    zLimiter.position.y += 16
    scene.add(zLimiter)
    const dummy = memoize(() => new Object3D())

    const treePine = memoize(() =>
      makeTreePine(getMeshMaterial('bark'), getMeshMaterial('pineNeedle'))
    )

    const treePineC = () => {
      const obj = treePine().clone()
      return obj
    }
    const treePineN = () => {
      const obj = treePine().clone()
      obj.position.set(0, 0, 32)
      return obj
    }
    const treePineS = () => {
      const obj = treePine().clone()
      obj.position.set(0, 0, -32)
      return obj
    }
    const treePineE = () => {
      const obj = treePine().clone()
      obj.position.set(32, 0, 0)
      return obj
    }
    const treePineW = () => {
      const obj = treePine().clone()
      obj.position.set(-32, 0, 0)
      return obj
    }
    const treePineNE = () => {
      const obj = treePine().clone()
      obj.position.set(32, 0, 32)
      return obj
    }
    const treePineSE = () => {
      const obj = treePine().clone()
      obj.position.set(32, 0, -32)
      return obj
    }
    const treePineNW = () => {
      const obj = treePine().clone()
      obj.position.set(-32, 0, 32)
      return obj
    }
    const treePineSW = () => {
      const obj = treePine().clone()
      obj.position.set(-32, 0, -32)
      return obj
    }

    const treePineMature = memoize(() =>
      makeTreePineMature(
        getMeshMaterial('bark'),
        getMeshMaterial('pineNeedle'),
        getMeshMaterial('wood')
      )
    )
    const treePineMatureC = () => {
      const obj = treePineMature().clone()
      return obj
    }
    const treePineMatureN = () => {
      const obj = treePineMature().clone()
      obj.position.set(0, 0, 32)
      return obj
    }
    const treePineMatureS = () => {
      const obj = treePineMature().clone()
      obj.position.set(0, 0, -32)
      return obj
    }
    const treePineMatureE = () => {
      const obj = treePineMature().clone()
      obj.position.set(32, 0, 0)
      return obj
    }
    const treePineMatureW = () => {
      const obj = treePineMature().clone()
      obj.position.set(-32, 0, 0)
      return obj
    }
    const treePineMatureNE = () => {
      const obj = treePineMature().clone()
      obj.position.set(32, 0, 32)
      return obj
    }
    const treePineMatureSE = () => {
      const obj = treePineMature().clone()
      obj.position.set(32, 0, -32)
      return obj
    }
    const treePineMatureNW = () => {
      const obj = treePineMature().clone()
      obj.position.set(-32, 0, 32)
      return obj
    }
    const treePineMatureSW = () => {
      const obj = treePineMature().clone()
      obj.position.set(-32, 0, -32)
      return obj
    }

    const treePineStump = memoize(() =>
      makeTreePineStump(getMeshMaterial('bark'), getMeshMaterial('wood'))
    )

    const treePineStumpMature = memoize(() =>
      makeTreePineStumpMature(getMeshMaterial('bark'), getMeshMaterial('wood'))
    )

    const treeMaple = memoize(() =>
      makeTreeMaple(getMeshMaterial('barkMaple'), getMeshMaterial('leafMaple'))
    )

    const treeMapleC = () => {
      const obj = treeMaple().clone()
      return obj
    }
    const treeMapleN = () => {
      const obj = treeMaple().clone()
      obj.position.set(0, 0, 32)
      return obj
    }
    const treeMapleS = () => {
      const obj = treeMaple().clone()
      obj.position.set(0, 0, -32)
      return obj
    }
    const treeMapleE = () => {
      const obj = treeMaple().clone()
      obj.position.set(32, 0, 0)
      return obj
    }
    const treeMapleW = () => {
      const obj = treeMaple().clone()
      obj.position.set(-32, 0, 0)
      return obj
    }
    const treeMapleNE = () => {
      const obj = treeMaple().clone()
      obj.position.set(32, 0, 32)
      return obj
    }
    const treeMapleSE = () => {
      const obj = treeMaple().clone()
      obj.position.set(32, 0, -32)
      return obj
    }
    const treeMapleNW = () => {
      const obj = treeMaple().clone()
      obj.position.set(-32, 0, 32)
      return obj
    }
    const treeMapleSW = () => {
      const obj = treeMaple().clone()
      obj.position.set(-32, 0, -32)
      return obj
    }

    const treeMapleMature = memoize(() =>
      makeTreeMapleMature(
        getMeshMaterial('barkMaple'),
        getMeshMaterial('leafMaple'),
        getMeshMaterial('woodMaple')
      )
    )
    const treeMapleMatureC = () => {
      const obj = treeMapleMature().clone()
      return obj
    }
    const treeMapleMatureN = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(0, 0, 32)
      return obj
    }
    const treeMapleMatureS = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(0, 0, -32)
      return obj
    }
    const treeMapleMatureE = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(32, 0, 0)
      return obj
    }
    const treeMapleMatureW = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(-32, 0, 0)
      return obj
    }
    const treeMapleMatureNE = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(32, 0, 32)
      return obj
    }
    const treeMapleMatureSE = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(32, 0, -32)
      return obj
    }
    const treeMapleMatureNW = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(-32, 0, 32)
      return obj
    }
    const treeMapleMatureSW = () => {
      const obj = treeMapleMature().clone()
      obj.position.set(-32, 0, -32)
      return obj
    }

    console.log('performance.now', performance.now())
    scene.updateMatrixWorld(true)
    console.log('performance.now', performance.now())

    const treeMapleStump = () =>
      makeTreeMapleStump(
        getMeshMaterial('barkMaple'),
        getMeshMaterial('woodMaple')
      )

    const treeMapleStumpMature = () =>
      makeTreeMapleStumpMature(
        getMeshMaterial('barkMaple'),
        getMeshMaterial('woodMaple')
      )

    const memoScene = (generator: () => Object3D) => {
      const memodGenerator = memoize(generator)
      return function generatorAndAdder() {
        const obj = memodGenerator()
        if (!obj.parent) {
          scene.add(obj)
          obj.updateWorldMatrix(false, true)
        }
        return obj
      }
    }

    const indexedMeshes: (() => Object3D)[] = [
      dummy,
      floor,
      beamCenter,
      beamN,
      beamE,
      beamS,
      beamW,
      beamFullSectionNS,
      beamFullSectionEW,
      brickWallSectionWR,
      brickWallSectionEL,
      brickWallSectionNR,
      brickWallSectionSR,
      brickWallSectionER,
      brickWallSectionWL,
      brickWallSectionSL,
      brickWallSectionNL,
      brickWallSectionNC,
      brickWallSectionEC,
      brickWallSectionSC,
      brickWallSectionWC,
      ground,
      grassC,
      grassN,
      grassNE,
      grassE,
      grassSE,
      grassS,
      grassSW,
      grassW,
      grassNW,
      bushC,
      bushN,
      bushNE,
      bushE,
      bushSE,
      bushS,
      bushSW,
      bushW,
      bushNW,
      goldPile,
      lampPost,
      testObject,
      pyramid,
      rockyGround,
      rocksC,
      rocksCBig,
      rocksN,
      rocksNE,
      rocksE,
      rocksSE,
      rocksS,
      rocksSW,
      rocksW,
      rocksNW,
      goldOreForRocks,
      goldOreForBigRocks,
      rockCrumbsC,
      rockCrumbsN,
      rockCrumbsNE,
      rockCrumbsE,
      rockCrumbsSE,
      rockCrumbsS,
      rockCrumbsSW,
      rockCrumbsW,
      rockCrumbsNW,
      treePineC,
      treePineN,
      treePineNE,
      treePineE,
      treePineSE,
      treePineS,
      treePineSW,
      treePineW,
      treePineNW,
      treePineMatureC,
      treePineMatureN,
      treePineMatureNE,
      treePineMatureE,
      treePineMatureSE,
      treePineMatureS,
      treePineMatureSW,
      treePineMatureW,
      treePineMatureNW,
      treePineStump,
      treePineStumpMature,
      treeMapleC,
      treeMapleN,
      treeMapleNE,
      treeMapleE,
      treeMapleSE,
      treeMapleS,
      treeMapleSW,
      treeMapleW,
      treeMapleNW,
      treeMapleMatureC,
      treeMapleMatureN,
      treeMapleMatureNE,
      treeMapleMatureE,
      treeMapleMatureSE,
      treeMapleMatureS,
      treeMapleMatureSW,
      treeMapleMatureW,
      treeMapleMatureNW,
      treeMapleStump,
      treeMapleStumpMature
    ]

    this._indexedMeshes = indexedMeshes.map(memoScene)
    this._indexedMeshesVisibility = new Array(indexedMeshes.length)
  }

  getTexture(pass: MaterialPassType = 'beauty') {
    if (this._renderTargets.has(pass)) {
      return this._renderTargets.get(pass)!.texture
    } else {
      debugger
      throw new Error(`pass "${pass}" not supported`)
    }
  }
  getTileId(tileDescription: Uint8Array) {
    // const hash = Buffer.from(tileDescription).toString('utf-8')
    const hash = tileDescription.toString()
    let index = this._tileHashRegistry.indexOf(hash)
    if (index === -1) {
      index = this._tileRegistry.length
      if (index >= this._maxTiles) {
        console.error(`no more room for tiles! (${index})`)
      }
      this._tileRegistry.push(tileDescription)
      this._tileHashRegistry.push(hash)
      this._renderQueue.push(index)
      this._tileTexNeedsUpdate = true
    }
    return index
  }
  render(renderer: WebGLRenderer) {
    if (this._tileTexNeedsUpdate) {
      const oldViewport = new Vector4()
      const oldScissor = new Vector4()
      renderer.getViewport(oldViewport)
      renderer.getScissor(oldScissor)
      this._tileTexNeedsUpdate = false
      this._scene.updateMatrixWorld(true)

      const uniqueVisuals = new Set()
      for (const index of this._renderQueue) {
        const visualProps = this._tileRegistry[index]
        for (let j = 0; j < this._indexedMeshes.length; j++) {
          const jb = ~~(j / 8)
          const j8 = j % 8
          const shouldShow = !!(visualProps[jb] & (1 << j8))
          if (shouldShow) {
            uniqueVisuals.add(j)
          }
        }
      }
      console.log('unique tiles:', this._renderQueue.length)
      console.log('unique visual elements:', Array.from(uniqueVisuals).length)

      for (const pass of this._passes) {
        renderer.setRenderTarget(this._renderTargets.get(pass)!)
        const p = this._pixelsPerTile / renderer.getPixelRatio()
        const depthPass = pass === 'customTopDownHeight'
        for (const index of this._renderQueue) {
          const iCol = index % this._tilesPerEdge
          const iRow = ~~(index / this._tilesPerEdge)
          const visualProps = this._tileRegistry[index]
          const layer2 = !!(visualProps[0] & 1)
          if (layer2 && depthPass) {
            continue
          }
          for (let j = 0; j < this._indexedMeshes.length; j++) {
            const jb = ~~(j / 8)
            const j8 = j % 8
            const shouldShow = !!(visualProps[jb] & (1 << j8))
            if (this._indexedMeshesVisibility[j] && !shouldShow) {
              this._indexedMeshes[j]().visible = false
            } else if (!this._indexedMeshesVisibility[j] && shouldShow) {
              this._indexedMeshes[j]().visible = true
            }
            this._indexedMeshesVisibility[j] = shouldShow
          }

          renderer.setViewport(iCol * p, iRow * p, p, p)
          renderer.setScissor(iCol * p, iRow * p, p, p)
          changeMeshMaterials(this._scene, pass, true)
          renderer.render(
            this._scene,
            layer2
              ? this._cameraTiltedTop
              : depthPass
              ? this._cameraTopDown
              : this._cameraTiltedBottom
          )
        }
      }
      renderer.setViewport(oldViewport)
      renderer.setScissor(oldScissor)
      renderer.setRenderTarget(null)
      this._renderQueue.length = 0
    }
  }
  update(dt: number) {
    //
  }
}
