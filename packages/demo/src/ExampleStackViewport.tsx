import React, { Component } from 'react'
import {
  cache,
  RenderingEngine,
  eventTarget,
  createAndCacheVolume,
  loadAndCacheImages,
  metaData,
  ORIENTATION,
  VIEWPORT_TYPE,
  EVENTS as RENDERING_EVENTS,
} from '@ohif/cornerstone-render'
import {
  SynchronizerManager,
  synchronizers,
  ToolGroupManager,
  ToolBindings,
  resetToolsState,
} from '@ohif/cornerstone-tools'

import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction'
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction'
import vtkColorMaps from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps'
import getImageIds from './helpers/getImageIds'
import ViewportGrid from './components/ViewportGrid'
import { initToolGroups, destroyToolGroups } from './initToolGroups'
import './ExampleVTKMPR.css'
import {
  renderingEngineUID,
  ctVolumeUID,
  ctStackUID,
  SCENE_IDS,
  VIEWPORT_IDS,
  PET_CT_ANNOTATION_TOOLS,
} from './constants'
import LAYOUTS, { stackCT } from './layouts'
import sortImageIdsByIPP from './helpers/sortImageIdsByIPP'
import * as cs from '@ohif/cornerstone-render'
import config from './config/default'
import { hardcodedMetaDataProvider } from './helpers/initCornerstone'

import { registerWebImageLoader } from '@ohif/cornerstone-image-loader-streaming-volume'
import getInterleavedFrames from './helpers/getInterleavedFrames'

const VIEWPORT_DX_COLOR = 'dx_and_color_viewport'

const VOLUME = 'volume'
const STACK = 'stack'

window.cache = cache

let ctSceneToolGroup, stackViewportToolGroup
const ctLayoutTools = ['Levels'].concat(PET_CT_ANNOTATION_TOOLS)

class StackViewportExample extends Component {
  state = {
    progressText: 'fetching metadata...',
    metadataLoaded: false,
    leftClickTool: 'WindowLevel',
    layoutIndex: 0,
    destroyed: false,
    //
    viewportGrid: {
      numCols: 2,
      numRows: 2,
      viewports: [{}, {}, {}, {}],
    },
    ptCtLeftClickTool: 'Levels',

    ctWindowLevelDisplay: { ww: 0, wc: 0 },
  }

  constructor(props) {
    super(props)

    registerWebImageLoader(cs)
    this._canvasNodes = new Map()
    this._viewportGridRef = React.createRef()
    this._offScreenRef = React.createRef()

    this.ctVolumeImageIdsPromise = getImageIds('ct1', VOLUME)

    this.ctStackImageIdsPromise = getImageIds('ct1', STACK)
    this.dxImageIdsPromise = getImageIds('dx', STACK)

    this.colorImageIds = config.colorImages.imageIds

    metaData.addProvider(
      (type, imageId) =>
        hardcodedMetaDataProvider(type, imageId, this.colorImageIds),
      10000
    )

    // Promise.all([this.petVolumeImageIds, this.ctImageIds]).then(() =>
    //   this.setState({ progressText: 'Loading data...' })
    // );
    // Promise.all([this.petCTImageIdsPromise, this.dxImageIdsPromise]).then(() =>
    //   this.setState({ progressText: 'Loading data...' })
    // )

    const {
      createCameraPositionSynchronizer,
      createVOISynchronizer,
    } = synchronizers

    this.axialSync = createCameraPositionSynchronizer('axialSync')
    // this.sagittalSync = createCameraPositionSynchronizer('sagittalSync')
    // this.coronalSync = createCameraPositionSynchronizer('coronalSync')
    // this.ctWLSync = createVOISynchronizer('ctWLSync')
    // this.ptThresholdSync = createVOISynchronizer('ptThresholdSync')

    this.viewportGridResizeObserver = new ResizeObserver((entries) => {
      // ThrottleFn? May not be needed. This is lightning fast.
      // Set in mount
      if (this.renderingEngine) {
        this.renderingEngine.resize()
        this.renderingEngine.render()
      }
    })
  }

  /**
   * LIFECYCLE
   */
  async componentDidMount() {
    ;({ ctSceneToolGroup, stackViewportToolGroup } = initToolGroups())

    this.ctVolumeUID = ctVolumeUID
    this.ctStackUID = ctStackUID

    // Create volumes
    const dxImageIds = await this.dxImageIdsPromise
    const ctStackImageIds = await this.ctStackImageIdsPromise

    const ctVolumeImageIds = await this.ctVolumeImageIdsPromise
    const colorImageIds = this.colorImageIds

    const renderingEngine = new RenderingEngine(renderingEngineUID)

    this.renderingEngine = renderingEngine
    window.renderingEngine = renderingEngine

    const viewportInput = [
      // CT volume axial
      {
        sceneUID: SCENE_IDS.CT,
        viewportUID: VIEWPORT_IDS.CT.AXIAL,
        type: VIEWPORT_TYPE.ORTHOGRAPHIC,
        canvas: this._canvasNodes.get(0),
        defaultOptions: {
          orientation: ORIENTATION.AXIAL,
        },
      },
      {
        sceneUID: SCENE_IDS.CT,
        viewportUID: VIEWPORT_IDS.CT.SAGITTAL,
        type: VIEWPORT_TYPE.ORTHOGRAPHIC,
        canvas: this._canvasNodes.get(1),
        defaultOptions: {
          orientation: ORIENTATION.SAGITTAL,
        },
      },
      // stack CT
      {
        viewportUID: VIEWPORT_IDS.STACK,
        type: VIEWPORT_TYPE.STACK,
        canvas: this._canvasNodes.get(2),
        defaultOptions: {
          orientation: ORIENTATION.AXIAL,
        },
      },
      // dx
      {
        viewportUID: VIEWPORT_DX_COLOR,
        type: VIEWPORT_TYPE.STACK,
        canvas: this._canvasNodes.get(3),
        defaultOptions: {
          orientation: ORIENTATION.AXIAL,
        },
      },
    ]

    renderingEngine.setViewports(viewportInput)

    // volume ct
    ctSceneToolGroup.addViewports(
      renderingEngineUID,
      SCENE_IDS.CT,
      VIEWPORT_IDS.CT.AXIAL
    )
    ctSceneToolGroup.addViewports(
      renderingEngineUID,
      SCENE_IDS.CT,
      VIEWPORT_IDS.CT.SAGITTAL
    )

    // stack ct
    stackViewportToolGroup.addViewports(
      renderingEngineUID,
      undefined,
      VIEWPORT_IDS.STACK
    )

    // dx and color
    stackViewportToolGroup.addViewports(
      renderingEngineUID,
      undefined,
      VIEWPORT_DX_COLOR
    )

    renderingEngine.render()

    const stackViewport = renderingEngine.getViewport(VIEWPORT_IDS.STACK)

    const middleSlice = Math.floor(ctStackImageIds.length / 2)
    await stackViewport.setStack(
      sortImageIdsByIPP(ctStackImageIds),
      middleSlice
    )

    // ct + dx + color
    const dxColorViewport = renderingEngine.getViewport(VIEWPORT_DX_COLOR)

    const fakeStake = [
      dxImageIds[0],
      colorImageIds[0],
      dxImageIds[1],
      ctStackImageIds[40],
      colorImageIds[1],
      colorImageIds[2],
      ctStackImageIds[41],
    ]
    await dxColorViewport.setStack(fakeStake)

    // This only creates the volumes, it does not actually load all
    // of the pixel data (yet)
    const ctVolume = await createAndCacheVolume(ctVolumeUID, {
      imageIds: ctVolumeImageIds,
    })

    // Initialize all CT values to -1024 so we don't get a grey box?
    const { scalarData } = ctVolume
    const ctLength = scalarData.length

    for (let i = 0; i < ctLength; i++) {
      scalarData[i] = -1024
    }

    const onLoad = () => this.setState({ progressText: 'Loaded.' })

    ctVolume.load(onLoad)

    const ctScene = renderingEngine.getScene(SCENE_IDS.CT)
    ctScene.setVolumes([
      {
        volumeUID: ctVolumeUID,
      },
    ])

    // Set initial CT levels in UI
    const { windowWidth, windowCenter } = ctVolume.metadata.voiLut[0]

    this.setState({
      metadataLoaded: true,
      ctWindowLevelDisplay: { ww: windowWidth, wc: windowCenter },
    })

    // This will initialise volumes in GPU memory
    renderingEngine.render()
    // Start listening for resize
    this.viewportGridResizeObserver.observe(this._viewportGridRef.current)
  }

  componentWillUnmount() {
    // Stop listening for resize
    if (this.viewportGridResizeObserver) {
      this.viewportGridResizeObserver.disconnect()
    }

    // Destroy synchronizers
    // SynchronizerManager.destroy()
    resetToolsState()
    cache.purgeCache()
    ToolGroupManager.destroy()

    this.renderingEngine.destroy()
  }

  showOffScreenCanvas = () => {
    // remove all childs
    this._offScreenRef.current.innerHTML = ''
    const uri = this.renderingEngine._debugRender()
    const image = document.createElement('img')
    image.src = uri
    image.setAttribute('width', '100%')

    this._offScreenRef.current.appendChild(image)
  }

  hidOffScreenCanvas = () => {
    // remove all childs
    this._offScreenRef.current.innerHTML = ''
  }

  toggleLengthAndWindowLevel = () => {
    const options = {
      bindings: [ToolBindings.Mouse.Primary],
    }

    let newTool
    if (this.state.leftClickTool === 'Length') {
      ctSceneToolGroup.setToolPassive('Length')
      stackViewportToolGroup.setToolPassive('Length')

      ctSceneToolGroup.setToolActive('WindowLevel', options)
      stackViewportToolGroup.setToolActive('WindowLevel', options)
      newTool = 'WindowLevel'
    } else {
      ctSceneToolGroup.setToolPassive('WindowLevel')
      stackViewportToolGroup.setToolPassive('WindowLevel')

      ctSceneToolGroup.setToolActive('Length', options)
      stackViewportToolGroup.setToolActive('Length', options)
      newTool = 'Length'
    }

    this.setState({ leftClickTool: newTool })
  }

  swapTools = (evt) => {
    const toolName = evt.target.value

    const isAnnotationToolOn = toolName !== 'Levels' ? true : false
    const options = {
      bindings: [ToolBindings.Mouse.Primary],
    }
    if (isAnnotationToolOn) {
      // Set tool active

      const toolsToSetPassive = PET_CT_ANNOTATION_TOOLS.filter(
        (toolName) => toolName !== toolName
      )

      ctSceneToolGroup.setToolActive(toolName, options)

      toolsToSetPassive.forEach((toolName) => {
        ctSceneToolGroup.setToolPassive(toolName)
      })

      ctSceneToolGroup.setToolDisabled('WindowLevel')
    } else {
      // Set window level + threshold
      ctSceneToolGroup.setToolActive('WindowLevel', options)

      // Set all annotation tools passive
      PET_CT_ANNOTATION_TOOLS.forEach((toolName) => {
        ctSceneToolGroup.setToolPassive(toolName)
      })
    }

    this.renderingEngine.render()
    this.setState({ ptCtLeftClickTool: toolName })
  }

  render() {
    return (
      <div>
        <div>
          <h1>Stack Viewport Example (setViewports API)</h1>
          <p>
            This is a demo for volume viewports (Top row) and stack viewports
            (bottom) using the same rendering engine
          </p>
        </div>
        <button
          onClick={() => this.toggleLengthAndWindowLevel()}
          className="btn btn-primary"
          style={{ margin: '2px 4px' }}
        >
          Toggle Length and WindowLevel
        </button>
        <div>
          <select
            value={this.state.ptCtLeftClickTool}
            onChange={this.swapTools}
          >
            {ctLayoutTools.map((toolName) => (
              <option key={toolName} value={toolName}>
                {toolName}
              </option>
            ))}
          </select>
        </div>
        <div style={{ paddingBottom: '55px' }}>
          <ViewportGrid
            numCols={this.state.viewportGrid.numCols}
            numRows={this.state.viewportGrid.numRows}
            renderingEngine={this.renderingEngine}
            style={{ minHeight: '650px', marginTop: '35px' }}
            ref={this._viewportGridRef}
          >
            {this.state.viewportGrid.viewports.map((vp, i) => (
              <div
                className="viewport-pane"
                style={{
                  ...(vp.cellStyle || {}),
                  border: '2px solid grey',
                  background: 'black',
                }}
                key={i}
              >
                <canvas ref={(c) => this._canvasNodes.set(i, c)} />
              </div>
            ))}
          </ViewportGrid>
        </div>
        <div>
          <h1>OffScreen Canvas Render</h1>
          <button
            onClick={this.showOffScreenCanvas}
            className="btn btn-primary"
            style={{ margin: '2px 4px' }}
          >
            Show OffScreenCanvas
          </button>
          <button
            onClick={this.hidOffScreenCanvas}
            className="btn btn-primary"
            style={{ margin: '2px 4px' }}
          >
            Hide OffScreenCanvas
          </button>
          <div ref={this._offScreenRef}></div>
        </div>
      </div>
    )
  }
}

export default StackViewportExample