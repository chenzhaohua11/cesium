import Check from "../../Core/Check.js";
import defaultValue from "../../Core/defaultValue.js";
import defined from "../../Core/defined.js";
import PrimitiveType from "../../Core/PrimitiveType.js";
import AlphaPipelineStage from "./AlphaPipelineStage.js";
import BatchTexturePipelineStage from "./BatchTexturePipelineStage.js";
import CustomShaderMode from "./CustomShaderMode.js";
import CustomShaderPipelineStage from "./CustomShaderPipelineStage.js";
import FeatureIdPipelineStage from "./FeatureIdPipelineStage.js";
import CPUStylingPipelineStage from "./CPUStylingPipelineStage.js";
import DequantizationPipelineStage from "./DequantizationPipelineStage.js";
import GeometryPipelineStage from "./GeometryPipelineStage.js";
import LightingPipelineStage from "./LightingPipelineStage.js";
import MaterialPipelineStage from "./MaterialPipelineStage.js";
import MetadataPipelineStage from "./MetadataPipelineStage.js";
import ModelExperimentalUtility from "./ModelExperimentalUtility.js";
import MorphTargetsPipelineStage from "./MorphTargetsPipelineStage.js";
import PickingPipelineStage from "./PickingPipelineStage.js";
import PointCloudStylingPipelineStage from "./PointCloudStylingPipelineStage.js";
import PrimitiveOutlinePipelineStage from "./PrimitiveOutlinePipelineStage.js";
import PrimitiveStatisticsPipelineStage from "./PrimitiveStatisticsPipelineStage.js";
import SceneMode from "../SceneMode.js";
import SceneMode2DPipelineStage from "./SceneMode2DPipelineStage.js";
import SelectedFeatureIdPipelineStage from "./SelectedFeatureIdPipelineStage.js";
import SkinningPipelineStage from "./SkinningPipelineStage.js";
import WireframePipelineStage from "./WireframePipelineStage.js";

/**
 * In memory representation of a single primitive, that is, a primitive
 * and its corresponding mesh.
 *
 * @param {Object} options An object containing the following options:
 * @param {ModelComponents.Primitive} options.primitive The primitive component.
 * @param {ModelComponents.Node} options.node The node that this primitive belongs to.
 * @param {ModelExperimental} options.model The {@link ModelExperimental} this primitive belongs to.
 *
 * @alias ModelRuntimePrimitive
 * @constructor
 *
 * @private
 */
export default function ModelRuntimePrimitive(options) {
  options = defaultValue(options, defaultValue.EMPTY_OBJECT);

  const primitive = options.primitive;
  const node = options.node;
  const model = options.model;
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("options.primitive", primitive);
  Check.typeOf.object("options.node", node);
  Check.typeOf.object("options.model", model);
  //>>includeEnd('debug');

  /**
   * The primitive component associated with this primitive.
   *
   * @type {ModelComponents.Primitive}
   *
   * @private
   */
  this.primitive = primitive;

  /**
   * A reference to the node this primitive belongs to.
   *
   * @type {ModelComponents.Node}
   *
   * @private
   */
  this.node = node;

  /**
   * A reference to the model
   *
   * @type {ModelExperimental}
   *
   * @private
   */
  this.model = model;

  /**
   * Pipeline stages to apply to this primitive. This
   * is an array of classes, each with a static method called
   * <code>process()</code>
   *
   * @type {Object[]}
   * @readonly
   *
   * @private
   */
  this.pipelineStages = [];

  /**
   * The generated {@link ModelDrawCommand} associated with this primitive.
   *
   * @type {ModelDrawCommand}
   *
   * @private
   */
  this.drawCommand = undefined;

  /**
   * The bounding sphere of this primitive in object-space.
   *
   * @type {BoundingSphere}
   *
   * @private
   */
  this.boundingSphere = undefined;

  /**
   * The bounding sphere of this primitive in 2D world space.
   *
   * @type {BoundingSphere}
   *
   * @private
   */
  this.boundingSphere2D = undefined;

  /**
   * A buffer containing the primitive's positions projected to 2D world coordinates.
   * Used for rendering in 2D / CV mode. The memory is managed by ModelExperimental;
   * this is just a reference.
   *
   * @type {Buffer}
   * @readonly
   *
   * @private
   */
  this.positionBuffer2D = undefined;

  /**
   * Update stages to apply to this primitive.
   *
   * @private
   */
  this.updateStages = [];
}

/**
 * Configure the primitive pipeline stages. If the pipeline needs to be re-run,
 * call this method again to ensure the correct sequence of pipeline stages are
 * used.
 *
 * @param {FrameState} frameState The frame state.
 *
 * @private
 */
ModelRuntimePrimitive.prototype.configurePipeline = function (frameState) {
  const pipelineStages = this.pipelineStages;
  pipelineStages.length = 0;

  const primitive = this.primitive;
  const node = this.node;
  const model = this.model;

  const customShader = model.customShader;
  const style = model.style;

  const useWebgl2 = frameState.context.webgl2;
  const mode = frameState.mode;
  const use2D =
    mode !== SceneMode.SCENE3D && !frameState.scene3DOnly && model._projectTo2D;

  const hasMorphTargets =
    defined(primitive.morphTargets) && primitive.morphTargets.length > 0;
  const hasSkinning = defined(node.skin);

  const hasCustomShader = defined(customShader);
  const hasCustomFragmentShader =
    hasCustomShader && defined(customShader.fragmentShaderText);
  const materialsEnabled =
    !hasCustomFragmentShader ||
    customShader.mode !== CustomShaderMode.REPLACE_MATERIAL;

  const hasQuantization = ModelExperimentalUtility.hasQuantizedAttributes(
    primitive.attributes
  );

  const generateWireframeIndices =
    model.debugWireframe &&
    PrimitiveType.isTriangles(primitive.primitiveType) &&
    // Generating index buffers for wireframes is always possible in WebGL2.
    // However, this will only work in WebGL1 if the model was constructed with
    // enableDebugWireframe set to true.
    (model._enableDebugWireframe || useWebgl2);

  const pointCloudShading = model.pointCloudShading;
  const hasAttenuation =
    defined(pointCloudShading) && pointCloudShading.attenuation;
  const hasPointCloudStyle =
    primitive.primitiveType === PrimitiveType.POINTS &&
    (defined(style) || hasAttenuation);

  const hasOutlines =
    model._enableShowOutline && defined(primitive.outlineCoordinates);

  const featureIdFlags = inspectFeatureIds(model, node, primitive);

  // Start of pipeline -----------------------------------------------------
  if (use2D) {
    pipelineStages.push(SceneMode2DPipelineStage);
  }

  pipelineStages.push(GeometryPipelineStage);

  if (generateWireframeIndices) {
    pipelineStages.push(WireframePipelineStage);
  }

  if (hasMorphTargets) {
    pipelineStages.push(MorphTargetsPipelineStage);
  }

  if (hasSkinning) {
    pipelineStages.push(SkinningPipelineStage);
  }

  if (hasPointCloudStyle) {
    pipelineStages.push(PointCloudStylingPipelineStage);
  }

  if (hasQuantization) {
    pipelineStages.push(DequantizationPipelineStage);
  }

  if (materialsEnabled) {
    pipelineStages.push(MaterialPipelineStage);
  }

  // These stages are always run to ensure structs
  // are declared to avoid compilation errors.
  pipelineStages.push(FeatureIdPipelineStage);
  pipelineStages.push(MetadataPipelineStage);

  if (featureIdFlags.hasPropertyTable) {
    pipelineStages.push(SelectedFeatureIdPipelineStage);
    pipelineStages.push(BatchTexturePipelineStage);
    pipelineStages.push(CPUStylingPipelineStage);
  }

  if (hasCustomShader) {
    pipelineStages.push(CustomShaderPipelineStage);
  }

  pipelineStages.push(LightingPipelineStage);

  if (model.allowPicking) {
    pipelineStages.push(PickingPipelineStage);
  }

  if (hasOutlines) {
    pipelineStages.push(PrimitiveOutlinePipelineStage);
  }

  pipelineStages.push(AlphaPipelineStage);

  pipelineStages.push(PrimitiveStatisticsPipelineStage);

  return;
};

function inspectFeatureIds(model, node, primitive) {
  let featureIds;
  // Check instances first, as this is the most specific type of
  // feature ID
  if (defined(node.instances)) {
    featureIds = ModelExperimentalUtility.getFeatureIdsByLabel(
      node.instances.featureIds,
      model.instanceFeatureIdLabel
    );

    if (defined(featureIds)) {
      return {
        hasFeatureIds: true,
        hasPropertyTable: defined(featureIds.propertyTableId),
      };
    }
  }

  featureIds = ModelExperimentalUtility.getFeatureIdsByLabel(
    primitive.featureIds,
    model.featureIdLabel
  );
  if (defined(featureIds)) {
    return {
      hasFeatureIds: true,
      hasPropertyTable: defined(featureIds.propertyTableId),
    };
  }

  return {
    hasFeatureIds: false,
    hasPropertyTable: false,
  };
}
