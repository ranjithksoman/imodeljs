/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { mount, shallow } from "enzyme";
import * as React from "react";
import * as sinon from "sinon";
import { ExpansionToggle } from "../../ui-core/tree/ExpansionToggle";

describe("<ExpansionToggle />", () => {
  it("should render", () => {
    mount(<ExpansionToggle />);
  });

  it("renders correctly", () => {
    shallow(<ExpansionToggle />).should.matchSnapshot();
  });

  it("should set is-focused class", () => {
    shallow(<ExpansionToggle isExpanded />).should.matchSnapshot();
  });

  it("should handle click events", () => {
    const handler = sinon.spy();
    const wrapper = shallow(<ExpansionToggle onClick={handler} />);
    wrapper.should.exist;

    const event = new MouseEvent("click");
    wrapper.simulate("click", event);
    handler.calledOnce.should.true;
    handler.should.have.been.calledWith(event);
  });
});
