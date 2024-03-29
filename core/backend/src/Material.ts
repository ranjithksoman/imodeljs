/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Elements */

import { Id64String } from "@bentley/bentleyjs-core";
import { BisCodeSpec, Code, CodeScopeProps, CodeSpec, RenderMaterialProps, TextureMapProps } from "@bentley/imodeljs-common";
import { DefinitionElement } from "./Element";
import { IModelDb } from "./IModelDb";

/** Defines a rendering material.
 * @public
 */
export class RenderMaterialElement extends DefinitionElement implements RenderMaterialProps {
  /** @internal */
  public static get className(): string { return "RenderMaterial"; }
  public paletteName: string;
  public description?: string;
  /** @internal */
  constructor(props: RenderMaterialProps, iModel: IModelDb) {
    super(props, iModel);
    this.paletteName = props.paletteName;
    this.description = props.description;
  }
  /** @internal */
  public toJSON(): RenderMaterialProps {
    const val = super.toJSON() as RenderMaterialProps;
    val.paletteName = this.paletteName;
    val.description = this.description;
    return val;
  }
  /** Create a Code for a RenderMaterial given a name that is meant to be unique within the scope of the specified DefinitionModel.
   * @param iModel  The IModelDb
   * @param scopeModelId The Id of the DefinitionModel that contains the RenderMaterial and provides the scope for its name.
   * @param name The RenderMaterial name
   */
  public static createCode(iModel: IModelDb, scopeModelId: CodeScopeProps, name: string): Code {
    const codeSpec: CodeSpec = iModel.codeSpecs.getByName(BisCodeSpec.texture);
    return 0 === name.length ? Code.createEmpty() : new Code({ spec: codeSpec.id, scope: scopeModelId, value: name });
  }
  /**
   * Create a RenderMaterial with given parameters.
   * @param iModelDb The iModel
   * @param definitionModelId The [[DefinitionModel]]
   * @param materialName The name/CodeValue of the RenderMaterial
   * @param params Parameters object which describes how to construct the RenderMaterial
   * @returns The newly constructed RenderMaterial element.
   * @throws [[IModelError]] if unable to create the element.
   */
  public static create(iModelDb: IModelDb, definitionModelId: Id64String, materialName: string, params: RenderMaterialElement.Params): RenderMaterialElement {
    const map = undefined !== params.patternMap ? { Pattern: params.patternMap } : undefined;
    const renderMaterialProps: RenderMaterialProps = {
      classFullName: this.classFullName,
      code: this.createCode(iModelDb, definitionModelId, materialName),
      paletteName: params.paletteName,
      description: params.description,
      jsonProperties: {
        materialAssets: {
          renderMaterial: {
            HasBaseColor: params.color !== undefined,
            color: params.color,
            HasSpecularColor: params.specularColor !== undefined,
            specular_color: params.specularColor,
            HasFinish: params.finish !== undefined,
            finish: params.finish,
            HasTransmit: params.transmit !== undefined,
            transmit: params.transmit,
            HasDiffuse: params.diffuse !== undefined,
            diffuse: params.diffuse,
            HasSpecular: params.specular !== undefined,
            specular: params.specular,
            HasReflect: params.reflect !== undefined,
            reflect: params.reflect,
            HasReflectColor: params.reflectColor !== undefined,
            reflect_color: params.reflectColor,
            Map: map,
          },
        },
      },
      model: definitionModelId,
      isPrivate: false,
    };
    return new RenderMaterialElement(renderMaterialProps, iModelDb);
  }
  /**
   * Insert a new RenderMaterial into a model.
   * @param iModelDb Insert into this iModel
   * @param definitionModelId Insert the new Texture into this DefinitionModel
   * @param materialName The name/CodeValue of the RenderMaterial
   * @param params Parameters object which describes how to construct the RenderMaterial
   * @returns The Id of the newly inserted RenderMaterial element.
   * @throws [[IModelError]] if unable to insert the element.
   */
  public static insert(iModelDb: IModelDb, definitionModelId: Id64String, materialName: string, params: RenderMaterialElement.Params): Id64String {
    const renderMaterial = this.create(iModelDb, definitionModelId, materialName, params);
    return iModelDb.elements.insertElement(renderMaterial);
  }
}

/** @public */
export namespace RenderMaterialElement {
  /** Parameters used to construct a [[RenderMaterial]]. */
  export class Params {
    /** The palette name which categorizes this RenderMaterial */
    public paletteName: string;
    /** The optional description for this RenderMaterial */
    public description?: string;
    /** If defined, use this color for surface fill or diffuse illumination; if undefined, defaults to black */
    public color?: number[];
    /** If defined, use this color for surface specular illumination; if undefined, defaults to black */
    public specularColor?: number[];
    /** If defined, apply this specular exponent(surface shininess); range is 0 to 128; if undefined, defaults to 15.0 * 0.9  */
    public finish?: number;
    /** If defined, apply this surface transparency; if undefined, defaults to 0.0 */
    public transmit?: number;
    /** If defined, apply this surface diffuse reflectivity; if undefined, defaults to 0.6 */
    public diffuse?: number;
    /** If defined, apply this surface specular reflectivity; if undefined, defaults to 0.0.  NOTE: The actual JSON allows a HasSpecular property to be true and the specular value itself undefined, in which case the value 0.4 would be used.  This API does not allow this case. */
    public specular?: number;
    /** If defined, apply this surface environmental reflectivity; stored as fraction of specular in V8 material settings; if undefined, defaults to 0.0 */
    public reflect?: number;
    /** If defined, apply this surface reflectance color; if undefined, defaults to whatever the specularColor is */
    public reflectColor?: number[];
    /** If defined, specifies the pattern mapping. */
    public patternMap?: TextureMapProps;

    /** Construct a new RenderMaterial.Params object with the specified paletteName.  Alter the public members on that object to specify settings. */
    public constructor(paletteName: string) {
      this.paletteName = paletteName;
    }
  }
}
