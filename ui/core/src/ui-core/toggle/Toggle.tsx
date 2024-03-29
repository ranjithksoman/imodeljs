/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Inputs */

import * as React from "react";
import * as classnames from "classnames";
import { CommonProps } from "../utils/Props";
import "./Toggle.scss";

/** Toggle display types
 * @public
 */
export enum ToggleButtonType {
  /** Primary (green) background */
  Primary,
  /** Blue background */
  Blue,
}

/** Properties for [[Toggle]] component
 * @public
 */
export interface ToggleProps extends CommonProps {
  /** Determine if the toggle is disabled or not */
  disabled?: boolean;
  /** Determine if the toggle is "on" or "off" */
  isOn?: boolean;
  /** Show the toggle rounded or square (rounded is default) */
  rounded?: boolean;
  /** Show a check mark icon when the toggle is "on" */
  showCheckmark?: boolean;
  /** Button type, either Primary or Blue */
  buttonType?: ToggleButtonType;
  /** Function called when the toggle state is changed */
  onChange?: (checked: boolean) => any;
  /** Function called when the toggle loses focus  */
  onBlur?: (event: React.FocusEvent) => any;
}

/** @internal */
interface ToggleState {
  height: number;
  width: number;
  checked: boolean;
}

/**
 * Toggle React component to show an "on" or "off state
 * @public
 */
export class Toggle extends React.PureComponent<ToggleProps, ToggleState> {
  private _padding: number = 2;

  constructor(props: ToggleProps) {
    super(props);

    this.state = { height: 0, width: 0, checked: this.props.isOn! };
  }

  public static defaultProps: Partial<ToggleProps> = {
    rounded: true,
    isOn: false,
    showCheckmark: false,
    buttonType: ToggleButtonType.Blue,
  };

  public componentDidUpdate(prevProps: ToggleProps) {
    if (this.props.isOn !== prevProps.isOn) {
      this.setState({ checked: this.props.isOn ? true : false });
      return;
    }
    if (this.props.disabled !== prevProps.disabled)
      this.forceUpdate();
  }

  private _handleChange = () => {
    this.setState(
      { checked: !this.state.checked },
      () => { this.props.onChange && this.props.onChange(this.state.checked); });
  }

  private _handleBlur = (event: React.FocusEvent) => {
    // istanbul ignore else
    if (this.props.onBlur)
      this.props.onBlur(event);
  }

  private _setHeight = (newHeight: number, newWidth: number) => {
    if (this.state.height !== newHeight || this.state.width !== newWidth) {
      this.setState({ height: newHeight, width: newWidth });
    }
  }

  private _getOffset(): number {
    return (this.state.checked) ? this.state.width - this.state.height : 0;
  }

  public render(): JSX.Element {
    const halfHeight = this.state.height / 2;
    const checkmarkClassName = classnames("core-toggle-checkmark", "icon", "icon-checkmark", this.props.showCheckmark && "visible");
    const toggleStyle: React.CSSProperties = { borderRadius: this.props.rounded ? halfHeight : 3, fontSize: halfHeight, ...this.props.style };
    const toggleClassName = classnames(
      "core-toggle",
      this.props.buttonType === ToggleButtonType.Primary && "core-toggle-primary",
      this.props.rounded && "rounded",
      this.props.disabled && "disabled",
      this.props.className);
    const toggleHandleStyle: React.CSSProperties = {
      width: this.state.height - (this._padding * 2),
      transform: "translateX(" + this._getOffset() + "px)",
      top: this._padding,
      bottom: this._padding,
      left: this._padding,
    };
    return (
      <label ref={(el) => { if (el) this._setHeight(el.clientHeight, el.clientWidth); }} style={toggleStyle} className={toggleClassName}>
        <input checked={this.state.checked} className="core-toggle-input" disabled={this.props.disabled} type="checkbox" onChange={this._handleChange} onBlur={this._handleBlur} />
        <span className="core-toggle-label" />
        <span className={checkmarkClassName} />
        <span className="core-toggle-handle" style={toggleHandleStyle} />
      </label>
    );
  }
}
