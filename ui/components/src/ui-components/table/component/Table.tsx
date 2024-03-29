/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
/** @module Table */

import { memoize } from "lodash";
import * as React from "react";
import ReactDataGrid from "react-data-grid";
import ReactResizeDetector from "react-resize-detector";
import classnames from "classnames";

import { DisposableList, Guid, GuidString } from "@bentley/bentleyjs-core";
import { PropertyValueFormat, PrimitiveValue } from "@bentley/imodeljs-frontend";
import {
  SortDirection, Dialog,
  LocalUiSettings, UiSettings, UiSettingsStatus, CommonProps,
} from "@bentley/ui-core";

import { TableDataProvider, ColumnDescription, RowItem, CellItem } from "../TableDataProvider";
import { SelectionMode } from "../../common/selection/SelectionModes";
import {
  SelectionHandler, SingleSelectionHandler, MultiSelectionHandler,
  OnItemsSelectedCallback, OnItemsDeselectedCallback,
} from "../../common/selection/SelectionHandler";
import { PropertyUpdatedArgs } from "../../editors/EditorContainer";
import { PropertyValueRendererManager, PropertyDialogState } from "../../properties/ValueRendererManager";
import { TypeConverterManager } from "../../converters/TypeConverterManager";
import { DragDropHeaderCell } from "./DragDropHeaderCell";
import { ShowHideMenu } from "../../common/showhide/ShowHideMenu";
import { TableIconCellContent, TableCellContent, TableCell } from "./TableCell";
import { TableRowStyleProvider } from "../../properties/ItemStyle";

import "./Table.scss";

const TABLE_ROW_HEIGHT = 25;

/**
 * Specifies table selection target.
 * @public
 */
export enum TableSelectionTarget {
  Row,
  Cell,
}

/** Properties for the Table React component
 * @public
 */
export interface TableProps extends CommonProps {
  /** Data provider for the Table */
  dataProvider: TableDataProvider;
  /** Amount of rows per page */
  pageAmount?: number;

  /** Called when rows are loaded */
  onRowsLoaded?: (firstRowIndex: number, lastRowIndex: number) => void;

  /** Callback for determining if row is selected */
  isRowSelected?: (row: RowItem) => boolean;
  /** Callback for when rows are selected */
  onRowsSelected?: (rowIterator: AsyncIterableIterator<RowItem>, replace: boolean) => Promise<boolean>;
  /** Callback for when rows are deselected */
  onRowsDeselected?: (rowIterator: AsyncIterableIterator<RowItem>) => Promise<boolean>;

  /** Callback for determining if cell is selected */
  isCellSelected?: (rowIndex: number, cell: CellItem) => boolean;
  /** Callback for when cells are selected */
  onCellsSelected?: (cellIterator: AsyncIterableIterator<[RowItem, CellItem]>, replace: boolean) => Promise<boolean>;
  /** Callback for when cells are deselected */
  onCellsDeselected?: (cellIterator: AsyncIterableIterator<[RowItem, CellItem]>) => Promise<boolean>;

  /** Specifies the selection target. */
  tableSelectionTarget?: TableSelectionTarget;
  /** Specifies the selection mode. */
  selectionMode?: SelectionMode;

  /** Callback for when properties are being edited @beta */
  onPropertyEditing?: (args: TableCellEditorState) => void;
  /** Callback for when properties are updated @beta */
  onPropertyUpdated?: (propertyArgs: PropertyUpdatedArgs, cellArgs: TableCellUpdatedArgs) => Promise<boolean>;

  /** @internal */
  renderRow?: (item: RowItem, props: TableRowProps) => React.ReactNode;
  /** Enables context menu to show/hide columns */
  showHideColumns?: boolean;
  /** Indicates whether the Table columns are reorderable */
  reorderableColumns?: boolean;
  /** Optional parameter for persistent UI settings. Used for column reordering and show persistency. */
  uiSettings?: UiSettings;
  /** Identifying string used for persistent state. */
  settingsIdentifier?: string;
  /** Custom property value renderer manager */
  propertyValueRendererManager?: PropertyValueRendererManager;
  /**
   * Gets called when rendering is finished. Should be used while testing to know when asynchronous rendering has finished.
   * @internal
   */
  onRender?: () => void;

  /** Hide the header */
  hideHeader?: boolean;
}

/** Properties for a Table cell
 * @public
 */
export interface CellProps {
  item: CellItem;
  displayValue: string;
  render: React.ComponentType<{ isSelected: boolean }>;
}

/** Properties for a Table row
 * @public
 */
export interface RowProps {
  index: number;
  item: RowItem;
  cells: { [key: string]: CellProps };
  render?: () => React.ReactNode;
  style?: React.CSSProperties;
}

interface RowsLoadResult {
  rows: RowProps[];
  selectedRowIndices: number[];
  selectedCellKeys: CellKey[];
}

/** Cell/Property Editor state
 * @public
 */
export interface TableCellEditorState {
  active: boolean;
  rowIndex?: number;
  colIndex?: number;
  cellKey?: string;
}

/** Cell/Property Updated Args
 * @public
 */
export interface TableCellUpdatedArgs {
  rowIndex: number;
  colIndex: number;
  cellKey: string;
}

/** @internal */
interface TableState {
  columns: ReactDataGridColumn[];
  hiddenColumns: string[];
  rows: RowProps[];
  rowsCount: number;
  menuVisible: boolean;
  menuX: number;
  menuY: number;
  cellEditorState: TableCellEditorState;
  dialog?: PropertyDialogState;
  // TODO: Enable, when table gets refactored
  // popup?: PropertyPopupState;
}

/** ReactDataGrid.Column with additional properties
 * @public
 */
export interface ReactDataGridColumn extends ReactDataGrid.Column<any> {
  icon?: boolean;
}

const initialState: TableState = {
  columns: [],
  hiddenColumns: [],
  rows: [],
  rowsCount: 0,
  cellEditorState: { active: false },
  menuVisible: false,
  menuX: 0,
  menuY: 0,
};

interface CellKey {
  rowIndex: number;
  columnKey: string;
}

/** TableRowRenderer props. */
interface TableRowRendererProps {
  rowRendererCreator: () => any;
}

/** ReactDataGrid requires a class component for the RowRenderer because it sets a ref to it. */
class TableRowRenderer extends React.Component<TableRowRendererProps> {
  public render() {
    const creatorFn = this.props.rowRendererCreator();
    return creatorFn(this.props);
  }
}

const enum TableUpdate {
  None = 0,
  Rows = 1,
  Complete = 2,
}

const enum UpdateStatus {
  Continue,
  Abort,
}

/**
 * Table React component
 * @public
 */
export class Table extends React.Component<TableProps, TableState> {

  private _pageAmount = 100;
  private _disposableListeners = new DisposableList();
  private _isMounted = false;
  private _currentUpdate = TableUpdate.None;
  private _pendingUpdate = TableUpdate.None;
  private _rowLoadGuid = Guid.createValue();
  private _rowSelectionHandler: SelectionHandler<number>;
  private _cellSelectionHandler: SelectionHandler<CellKey>;
  private _selectedRowIndices: Set<number> = new Set();
  private _selectedCellKeys: Map<string, Set<number>> = new Map(); // column keys -> rowIndices
  private _rowItemSelectionHandlers?: Array<SingleSelectionHandler<number>>;
  private _cellItemSelectionHandlers?: Array<Array<SingleSelectionHandler<CellKey>>>;
  private _pressedItemSelected: boolean = false;
  private _tableRef = React.createRef<HTMLDivElement>();

  /** @internal */
  public readonly state = initialState;

  /** @internal */
  constructor(props: TableProps) {
    super(props);

    if (props.pageAmount)
      this._pageAmount = props.pageAmount;

    this._disposableListeners.add(props.dataProvider.onColumnsChanged.addListener(this._onColumnsChanged));
    this._disposableListeners.add(props.dataProvider.onRowsChanged.addListener(this._onRowsChanged));
    this._rowSelectionHandler = new SelectionHandler(props.selectionMode ? props.selectionMode : SelectionMode.Single);
    this._cellSelectionHandler = new SelectionHandler(props.selectionMode ? props.selectionMode : SelectionMode.Single);
    this._rowSelectionHandler.onItemsSelectedCallback = this._onRowsSelected;
    this._rowSelectionHandler.onItemsDeselectedCallback = this._onRowsDeselected;
    this._cellSelectionHandler.onItemsSelectedCallback = this._onCellsSelected;
    this._cellSelectionHandler.onItemsDeselectedCallback = this._onCellsDeselected;
  }

  // tslint:disable-next-line:naming-convention
  private get rowItemSelectionHandlers(): Array<SingleSelectionHandler<number>> {
    if (!this._rowItemSelectionHandlers) {
      this._rowItemSelectionHandlers = [];
      for (let i = 0; i < this.state.rowsCount; i++)
        this._rowItemSelectionHandlers.push(this.createRowItemSelectionHandler(i));
    }
    return this._rowItemSelectionHandlers;
  }

  // tslint:disable-next-line:naming-convention
  private get cellItemSelectionHandlers(): Array<Array<SingleSelectionHandler<CellKey>>> {
    if (!this._cellItemSelectionHandlers) {
      this._cellItemSelectionHandlers = [];
      for (let rowIndex = 0; rowIndex < this.state.rowsCount; rowIndex++) {
        this._cellItemSelectionHandlers[rowIndex] = [];
        for (const column of this.state.columns) {
          this._cellItemSelectionHandlers[rowIndex].push(this.createCellItemSelectionHandler({ rowIndex, columnKey: column.key }));
        }
      }
    }
    return this._cellItemSelectionHandlers;
  }

  private async * createRowIterator(rowIndices: number[]): AsyncIterableIterator<RowItem> {
    for (const index of rowIndices)
      yield await this.props.dataProvider.getRow(index);
  }

  private async * createCellIterator(cellKeys: CellKey[]): AsyncIterableIterator<[RowItem, CellItem]> {
    for (const key of cellKeys) {
      const row = await this.props.dataProvider.getRow(key.rowIndex);
      yield [row, this._getCellItem(row, key.columnKey)];
    }
  }

  private _onRowsSelected: OnItemsSelectedCallback<number> = (rowIndices: number[], replace: boolean) => {
    if (this.props.onRowsSelected)
      this.props.onRowsSelected(this.createRowIterator(rowIndices), replace); // tslint:disable-line:no-floating-promises
  }

  private _onRowsDeselected: OnItemsDeselectedCallback<number> = (rowIndices: number[]) => {
    if (this.props.onRowsDeselected)
      this.props.onRowsDeselected(this.createRowIterator(rowIndices)); // tslint:disable-line:no-floating-promises
  }

  private _onCellsSelected: OnItemsSelectedCallback<CellKey> = (cellKeys: CellKey[], replace: boolean) => {
    if (this.props.onCellsSelected)
      this.props.onCellsSelected(this.createCellIterator(cellKeys), replace); // tslint:disable-line:no-floating-promises
  }

  private _onCellsDeselected: OnItemsDeselectedCallback<CellKey> = (cellKeys: CellKey[]) => {
    if (this.props.onCellsDeselected)
      this.props.onCellsDeselected(this.createCellIterator(cellKeys)); // tslint:disable-line:no-floating-promises
  }

  private get _tableSelectionTarget(): TableSelectionTarget {
    return this.props.tableSelectionTarget ? this.props.tableSelectionTarget : TableSelectionTarget.Row;
  }

  /** @internal */
  public componentWillReceiveProps(newProps: TableProps) {
    this._rowSelectionHandler.selectionMode = newProps.selectionMode ? newProps.selectionMode : SelectionMode.Single;
    this._cellSelectionHandler.selectionMode = newProps.selectionMode ? newProps.selectionMode : SelectionMode.Single;

    if (this.props.dataProvider !== newProps.dataProvider) {
      this._disposableListeners.dispose();
      this._disposableListeners.add(newProps.dataProvider.onColumnsChanged.addListener(this._onColumnsChanged));
      this._disposableListeners.add(newProps.dataProvider.onRowsChanged.addListener(this._onRowsChanged));
    }
  }

  /** @internal */
  public componentDidUpdate(previousProps: TableProps) {
    if (this.props.dataProvider !== previousProps.dataProvider) {
      // tslint:disable-next-line:no-floating-promises
      this.update();
      return;
    }
    if (this.props.isCellSelected !== previousProps.isCellSelected
      || this.props.isRowSelected !== previousProps.isRowSelected) {
      this.updateSelectedRows();
      this.updateSelectedCells();
    }

    /* istanbul ignore next */
    if (this.props.onRender)
      this.props.onRender();
  }

  /** @internal */
  public componentDidMount() {
    this._isMounted = true;

    // tslint:disable-next-line:no-floating-promises
    this.update();
  }

  /** @internal */
  public componentWillUnmount() {
    this._isMounted = false;
    this._disposableListeners.dispose();
  }

  private async handlePendingUpdate(): Promise<UpdateStatus> {
    const update = this._pendingUpdate;
    this._pendingUpdate = TableUpdate.None;

    let status = UpdateStatus.Continue;
    if (update === TableUpdate.Complete)
      status = await this.updateColumns();
    if (status === UpdateStatus.Continue && update > TableUpdate.None)
      status = await this.updateRows();
    return status;
  }

  private async updateColumns(): Promise<UpdateStatus> {
    if (this._currentUpdate !== TableUpdate.None) {
      this._pendingUpdate = TableUpdate.Complete;
      return UpdateStatus.Abort;
    }

    this._currentUpdate = TableUpdate.Complete;
    const columnDescriptions = await this.props.dataProvider.getColumns();
    this._currentUpdate = TableUpdate.None;

    if (!this._isMounted)
      return UpdateStatus.Abort;

    if (this._pendingUpdate === TableUpdate.Complete) {
      await this.handlePendingUpdate();
      return UpdateStatus.Abort;
    }

    let columns = columnDescriptions.map(this._columnDescriptionToReactDataGridColumn);
    if (this.props.settingsIdentifier) {
      const uiSettings: UiSettings = this.props.uiSettings || new LocalUiSettings();
      const reorderResult = uiSettings.getSetting(this.props.settingsIdentifier, "ColumnReorder");
      if (reorderResult.status === UiSettingsStatus.Success) {
        const setting = reorderResult.setting as string[];
        // map columns according to the keys in columns, in the order of the loaded array of keys
        columns = setting.map((key) => columns.filter((col) => col.key === key)[0]);
      } else if (reorderResult.status === UiSettingsStatus.NotFound) {
        const keys = columnDescriptions.map((col) => col.key);
        uiSettings.saveSetting(this.props.settingsIdentifier, "ColumnReorder", keys);
      }
      const showhideResult = uiSettings.getSetting(this.props.settingsIdentifier, "ColumnShowHideHiddenColumns");
      if (showhideResult.status === UiSettingsStatus.Success) {
        const hiddenColumns = showhideResult.setting as string[];
        this.setState({ hiddenColumns });
      }
    }
    this.setState({ columns });

    if (this._pendingUpdate !== TableUpdate.None) {
      return this.handlePendingUpdate();
    }
    return UpdateStatus.Continue;
  }

  private _onColumnsChanged = async () => {
    await this.updateColumns();

    this._cellItemSelectionHandlers = undefined;
  }

  private async updateRows(): Promise<UpdateStatus> {
    if (this._currentUpdate !== TableUpdate.None) {
      if (this._pendingUpdate === TableUpdate.None)
        this._pendingUpdate = TableUpdate.Rows;
      return UpdateStatus.Abort;
    }

    this._currentUpdate = TableUpdate.Rows;
    const rowsCount = await this.props.dataProvider.getRowsCount();
    this._currentUpdate = TableUpdate.None;

    if (!this._isMounted)
      return UpdateStatus.Abort;

    if (this._pendingUpdate !== TableUpdate.None) {
      return this.handlePendingUpdate();
    }

    if (rowsCount !== this.state.rowsCount) {
      this._rowItemSelectionHandlers = undefined;
      this._cellItemSelectionHandlers = undefined;
    }

    this._rowGetterAsync.cache.clear!();
    this.setState({ rowsCount, rows: [] });
    this._rowGetterAsync(0, true); // tslint:disable-line:no-floating-promises
    return UpdateStatus.Continue;
  }

  private _onRowsChanged = async () => {
    await this.updateRows();
  }

  /** @internal */
  public async update(): Promise<UpdateStatus> {
    let status = await this.updateColumns();

    if (status !== UpdateStatus.Abort)
      status = await this.updateRows();

    /* istanbul ignore next */
    if (this.props.onRender)
      this.props.onRender();

    return status;
  }

  /** @internal */
  public updateSelectedRows() {
    const selectedRowIndices = new Set();
    if (this.props.isRowSelected) {
      for (let rowIndex = 0; rowIndex < this.state.rows.length; rowIndex++) {
        if (this.state.rows[rowIndex] && this.props.isRowSelected(this.state.rows[rowIndex].item))
          selectedRowIndices.add(rowIndex);
      }
    }
    this._selectedRowIndices = selectedRowIndices;
    this.forceUpdate();
  }

  /** @internal */
  public updateSelectedCells() {
    const selectedCellKeys = new Map<string, Set<number>>();
    if (this.props.isCellSelected) {
      for (const column of this.state.columns) {
        const set = new Set<number>();
        for (let rowIndex = 0; rowIndex < this.state.rows.length; rowIndex++) {
          if (!this.state.rows[rowIndex])
            continue;
          const cellItem = this._getCellItem(this.state.rows[rowIndex].item, column.key);
          if (this.props.isCellSelected(rowIndex, cellItem))
            set.add(rowIndex);
        }
        if (set.size !== 0)
          selectedCellKeys.set(column.key, set);
      }
    }
    this._selectedCellKeys = selectedCellKeys;
    this.forceUpdate();
  }

  private _columnDescriptionToReactDataGridColumn = (columnDescription: ColumnDescription): ReactDataGridColumn => {
    const isEditable = !!columnDescription.editable;

    const column: ReactDataGridColumn = {
      key: columnDescription.key,
      name: columnDescription.label,
      icon: columnDescription.icon,
      resizable: columnDescription.resizable !== undefined ? columnDescription.resizable : false,
      sortable: columnDescription.sortable !== undefined ? columnDescription.sortable : false,
      draggable: this.props.reorderableColumns || false,
    };

    if (isEditable) {
      column.events = {
        onClick: this.cellEditOnClick.bind(this, column),
      };
    }

    return column;
  }

  private _getCellItem = (row: RowItem, columnKey: string): CellItem => {
    return row.cells.find((cell: CellItem) => cell.key === columnKey) || { key: columnKey };
  }

  private isCellSelected(key: CellKey) {
    const set = this._selectedCellKeys.get(key.columnKey);
    if (set)
      return set.has(key.rowIndex);
    return false;
  }

  private selectCells(cellKeys: CellKey[]) {
    for (const key of cellKeys) {
      let set = this._selectedCellKeys.get(key.columnKey);
      if (!set) {
        set = new Set();
        this._selectedCellKeys.set(key.columnKey, set);
      }
      set.add(key.rowIndex);
    }
  }

  private deselectCells(cellKeys: CellKey[]) {
    for (const key of cellKeys) {
      const set = this._selectedCellKeys.get(key.columnKey);
      if (set)
        set.delete(key.rowIndex);
    }
  }

  private createRowItemSelectionHandler(rowIndex: number): SingleSelectionHandler<number> {
    return {
      preselect: () => {
        this._pressedItemSelected = this._selectedRowIndices.has(rowIndex);
      },
      select: () => {
        if (!this._selectedRowIndices.has(rowIndex)) {
          this._selectedRowIndices.add(rowIndex);
          if (!this._pressedItemSelected)
            this.forceUpdate();
        }
      },
      deselect: () => {
        if (this._selectedRowIndices.has(rowIndex)) {
          this._selectedRowIndices.delete(rowIndex);
          this.forceUpdate();
        }
      },
      isSelected: () => this._selectedRowIndices.has(rowIndex),
      item: () => rowIndex,
    };
  }

  private _rowComponentSelectionHandler: MultiSelectionHandler<number> = {
    deselectAll: () => {
      this._selectedRowIndices = new Set();
      if (!this._pressedItemSelected) {
        this._deactivateCellEditor();
        this.forceUpdate();
      }
    },
    selectBetween: (rowIndex1: number, rowIndex2: number) => {
      const selections = [];
      const lowerNumber = rowIndex1 < rowIndex2 ? rowIndex1 : rowIndex2;
      const higherNumber = rowIndex1 > rowIndex2 ? rowIndex1 : rowIndex2;
      for (let i = lowerNumber; i <= higherNumber; i++) {
        if (!this._selectedRowIndices.has(i)) {
          selections.push(i);
          this._selectedRowIndices.add(i);
        }
      }

      this.forceUpdate();
      return selections;
    },
    updateSelection: (selections: number[], deselections: number[]): void => {
      for (const rowIndex of selections) {
        if (!this._selectedRowIndices.has(rowIndex))
          this._selectedRowIndices.add(rowIndex);
      }

      for (const rowIndex of deselections) {
        if (this._selectedRowIndices.has(rowIndex))
          this._selectedRowIndices.delete(rowIndex);
      }
      this.forceUpdate();
    },
    areEqual: (item1: number, item2: number) => item1 === item2,
  };

  private createCellItemSelectionHandler(cellKey: CellKey): SingleSelectionHandler<CellKey> {
    return {
      preselect: () => {
        this._pressedItemSelected = this.isCellSelected(cellKey);
      },
      select: () => {
        this.selectCells([cellKey]);
        this.forceUpdate();
      },
      deselect: () => {
        this.deselectCells([cellKey]);
        this.forceUpdate();
      },
      isSelected: () => this.isCellSelected(cellKey),
      item: () => cellKey,
    };
  }

  private _cellComponentSelectionHandler: MultiSelectionHandler<CellKey> = {
    deselectAll: () => {
      this._selectedCellKeys = new Map();
      this.forceUpdate();
    },
    selectBetween: (item1: CellKey, item2: CellKey) => {
      const selections: CellKey[] = [];
      const lowerIndex = item1.rowIndex < item2.rowIndex ? item1.rowIndex : item2.rowIndex;
      const higherIndex = item1.rowIndex > item2.rowIndex ? item1.rowIndex : item2.rowIndex;
      let secondItem: CellKey;
      let firstItemFound = false;
      let secondItemFound = false;

      for (let rowIndex = lowerIndex; rowIndex <= higherIndex; rowIndex++) {
        for (const column of this.state.columns) {
          if (!firstItemFound) {
            if (rowIndex === item1.rowIndex && column.key === item1.columnKey) {
              firstItemFound = true;
              secondItem = item2;
            } else if (rowIndex === item2.rowIndex && column.key === item2.columnKey) {
              firstItemFound = true;
              secondItem = item1;
            } else
              continue;
          }

          const cellKey = { rowIndex, columnKey: column.key };
          if (!this.isCellSelected(cellKey))
            selections.push(cellKey);

          if (rowIndex === secondItem!.rowIndex && column.key === secondItem!.columnKey) {
            secondItemFound = true;
            break;
          }
        }
        if (secondItemFound)
          break;
      }

      this.selectCells(selections);
      this.forceUpdate();
      return selections;
    },
    updateSelection: (selections: CellKey[], deselections: CellKey[]): void => {
      this.selectCells(selections);
      this.deselectCells(deselections);
      this.forceUpdate();
    },
    areEqual: (item1: CellKey, item2: CellKey) => item1.rowIndex === item2.rowIndex && item1.columnKey === item2.columnKey,
  };

  private _rowGetter = (i: number): RowProps => {
    if (this.state.rows[i])
      return this.state.rows[i];

    // get another page of rows
    // note: always start loading at the beginning of a page to avoid
    // requesting duplicate data (e.g. a page that starts at 0, at 1, at 2, ...)
    this._rowGetterAsync(i - (i % this._pageAmount), false); // tslint:disable-line:no-floating-promises

    // Return placeholder object
    return { item: { key: "", cells: [] }, index: i, cells: {} };
  }

  private _rowGetterAsync = memoize(async (index: number, clearRows: boolean): Promise<void> => {
    if (index < 0)
      return;

    // load up to `this._pageAmount` more rows
    const maxIndex = Math.min(this.state.rowsCount, index + this._pageAmount);
    const loadResult = await this.loadRows(index, maxIndex);

    if (!this._isMounted)
      return;

    if (this._pendingUpdate !== TableUpdate.None)
      return;

    const selectedRowIndices = this._selectedRowIndices;
    for (const rowIndex of loadResult.selectedRowIndices) {
      if (!selectedRowIndices.has(rowIndex))
        selectedRowIndices.add(rowIndex);
    }
    this._selectedRowIndices = selectedRowIndices;

    this.selectCells(loadResult.selectedCellKeys);
    this.setState((prev) => {
      const rows = clearRows ? [] : [...prev.rows];
      loadResult.rows.forEach((r, i) => { rows[index + i] = r; });
      return { rows };
    }, () => {
      if (this.props.onRowsLoaded)
        this.props.onRowsLoaded(index, index + loadResult.rows.length - 1);
    });
  });

  private async renderCellContent(cellItem: CellItem, column: ReactDataGridColumn, displayValue: string): Promise<React.ComponentType<{ isSelected: boolean }>> {
    if (column.icon)
      return () => <TableIconCellContent iconName={displayValue} />;

    return (props: { isSelected: boolean }) => (
      <TableCellContent
        height={TABLE_ROW_HEIGHT}
        isSelected={props.isSelected}
        cellItem={cellItem}
        onDialogOpen={this._onDialogOpen}
        propertyValueRendererManager={this.props.propertyValueRendererManager
          ? this.props.propertyValueRendererManager
          : PropertyValueRendererManager.defaultManager}
      />
    );
  }

  private async getCellDisplayValue(cellItem: CellItem): Promise<string> {
    if (!cellItem.record || cellItem.record!.value.valueFormat !== PropertyValueFormat.Primitive)
      return "";

    const value = (cellItem.record!.value as PrimitiveValue).value;

    if (value === undefined)
      return "";

    const displayValue = await TypeConverterManager
      .getConverter(cellItem.record!.property.typename)
      .convertPropertyToString(cellItem.record!.property, value);

    return displayValue ? displayValue : "";
  }

  private async createPropsForRowItem(item: RowItem, index: number): Promise<RowProps> {
    const cellProps: { [key: string]: CellProps } = {};
    for (const column of this.state.columns) {
      const cellItem = this._getCellItem(item, column.key);
      const displayValue = await this.getCellDisplayValue(cellItem);
      cellProps[column.key] = {
        item: cellItem,
        displayValue,
        render: await this.renderCellContent(cellItem, column, displayValue),
      };
    }
    const rowStyle = TableRowStyleProvider.createStyle(item.colorOverrides ? item.colorOverrides : {});
    return {
      item,
      index,
      cells: cellProps,
      render: undefined,
      style: rowStyle,
    };
  }

  private async loadRows(beginIndex: number, endIndex: number): Promise<RowsLoadResult> {
    const result: RowsLoadResult = {
      rows: [],
      selectedRowIndices: [],
      selectedCellKeys: [],
    };
    this._rowLoadGuid = Guid.createValue();
    const currentSelectedRowGuid: GuidString = this._rowLoadGuid;

    const promises = new Array<Promise<RowProps>>();
    for (let i = beginIndex; i < endIndex; ++i) {
      promises.push(
        this.props.dataProvider.getRow(i).then(async (rowData) =>
          this.createPropsForRowItem(rowData, i).then((rowProps) => (rowProps)),
        ));
    }

    try {
      result.rows = await Promise.all(promises);
    } catch { }

    // Check if another loadRows got called while this one was still going
    if (currentSelectedRowGuid === this._rowLoadGuid) {
      for (const rowProps of result.rows) {
        if (this.props.isRowSelected && this.props.isRowSelected(rowProps.item))
          result.selectedRowIndices.push(rowProps.index);

        if (this.props.isCellSelected) {
          for (const column of this.state.columns) {
            const cellItem = this._getCellItem(rowProps.item, column.key);
            if (this.props.isCellSelected(rowProps.index, cellItem))
              result.selectedCellKeys.push({ rowIndex: rowProps.index, columnKey: column.key });
          }
        }
      }
    }

    return result;
  }

  private _handleGridSort = (columnKey: string, sortDirection: "ASC" | "DESC" | "NONE") => {
    let directionEnum: SortDirection;

    switch (sortDirection) {
      case "ASC":
        directionEnum = SortDirection.Ascending;
        break;
      case "DESC":
        directionEnum = SortDirection.Descending;
        break;
      case "NONE":
      default:
        directionEnum = SortDirection.NoSort;
        break;
    }

    // Sort the column
    this.gridSortAsync(columnKey, directionEnum); // tslint:disable-line:no-floating-promises
  }

  private getColumnIndexFromKey(columnKey: string): number {
    let columnIndex: number = -1;

    for (let i = 0; i < this.state.columns.length; i++) {
      const column = this.state.columns[i];
      if (column.key === columnKey) {
        columnIndex = i;
        break;
      }
    }

    return columnIndex;
  }

  private async gridSortAsync(columnKey: string, directionEnum: SortDirection) {
    let columnIndex = this.getColumnIndexFromKey(columnKey);
    if (columnIndex < 0)
      return;

    for (let i = 0; i < this.state.columns.length; i++) {
      const column = this.state.columns[i];
      if (column.key === columnKey) {
        columnIndex = i;
        break;
      }
    }

    await this.props.dataProvider.sort(columnIndex, directionEnum);
    if (!this._isMounted)
      return;

    this.updateRows(); // tslint:disable-line:no-floating-promises
  }

  private createRowCells(rowProps: RowProps, isSelected: boolean): { [columnKey: string]: React.ReactNode } {
    const cells: { [columnKey: string]: React.ReactNode } = {};

    for (let index = 0; index < this.state.columns.length; index++) {
      const column = this.state.columns[index];

      const cellProps = rowProps.cells[column.key];
      if (!cellProps) {
        continue;
      }
      // tslint:disable-next-line:variable-name
      const CellContent = cellProps.render;
      const isEditorCell =
        this.state.cellEditorState.active
        && this.state.cellEditorState.rowIndex === rowProps.index
        && this.state.cellEditorState.colIndex === index
        && cellProps.item.record;

      let onClick: ((e: React.MouseEvent) => void) | undefined;
      let onMouseMove: ((e: React.MouseEvent) => void) | undefined;
      let onMouseDown: ((e: React.MouseEvent) => void) | undefined;
      let className: string | undefined;

      if (this._tableSelectionTarget === TableSelectionTarget.Cell) {
        const cellKey = { rowIndex: rowProps.index, columnKey: column.key };
        const selectionHandler = this.createCellItemSelectionHandler(cellKey);
        const selectionFunction = this._cellSelectionHandler.createSelectionFunction(this._cellComponentSelectionHandler, selectionHandler);
        onClick = (e: React.MouseEvent) => selectionFunction(e.shiftKey, e.ctrlKey);
        onMouseMove = (e: React.MouseEvent) => { if (e.buttons === 1) this._cellSelectionHandler.updateDragAction(cellKey); };
        onMouseDown = () => {
          this._cellSelectionHandler.createDragAction(this._cellComponentSelectionHandler, this.cellItemSelectionHandlers, cellKey);
        };
        isSelected = this.isCellSelected(cellKey);
        className = classnames(isSelected ? "is-selected" : "is-hover-enabled");
      }

      cells[column.key] = (
        <TableCell
          className={className}
          title={cellProps.displayValue}
          onClick={onClick}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          cellEditingProps={isEditorCell ? {
            onCancel: this._deactivateCellEditor,
            onCommit: this._onCellCommit,
            propertyRecord: cellProps.item.record!,
            setFocus: true,
          } : undefined}
        >
          <CellContent isSelected={isSelected} />
        </TableCell>
      );
    }
    return cells;
  }

  private _createRowRenderer = () => {
    return (props: { row: RowProps, [k: string]: React.ReactNode }) => {
      const renderRow = this.props.renderRow ? this.props.renderRow : this.renderRow;
      const { row: rowProps, ...reactDataGridRowProps } = props;
      if (this._tableSelectionTarget === TableSelectionTarget.Row) {
        const selectionFunction = this._rowSelectionHandler.createSelectionFunction(this._rowComponentSelectionHandler, this.createRowItemSelectionHandler(props.row.index));
        const onClick = (e: React.MouseEvent) => selectionFunction(e.shiftKey, e.ctrlKey);
        const onMouseDown = () => {
          this._rowSelectionHandler.createDragAction(this._rowComponentSelectionHandler, [this.rowItemSelectionHandlers], props.row.index);
        };
        const onMouseMove = (e: React.MouseEvent) => {
          if (e.buttons === 1)
            this._rowSelectionHandler.updateDragAction(props.row.index);
        };
        const isSelected = this._selectedRowIndices.has(props.row.index);
        const cells = this.createRowCells(rowProps, isSelected);
        const row = renderRow(rowProps.item, { ...reactDataGridRowProps, cells, isSelected });
        return <div
          className={classnames("components-table-row", !isSelected && "is-hover-enabled")}
          onClickCapture={onClick}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          style={props.row.style}>
          {row}
        </div>;
      } else {
        const cells = this.createRowCells(rowProps, false);
        return renderRow(rowProps.item, { ...reactDataGridRowProps, cells });
      }
    };
  }

  // tslint:disable-next-line:naming-convention
  private renderRow = (item: RowItem, props: TableRowProps): React.ReactNode => {
    return <TableRow key={item.key} {...props} />;
  }

  private _onMouseUp = () => {
    if (this._tableSelectionTarget === TableSelectionTarget.Row)
      this._rowSelectionHandler.completeDragAction();
    else
      this._cellSelectionHandler.completeDragAction();
  }

  private _onMouseDown = () => {
    document.addEventListener("mouseup", this._onMouseUp, { capture: true, once: true });
  }
  private _onHeaderDrop = (source: string, target: string) => {
    const cols = [...this.state.columns];
    const columnSourceIndex = this.state.columns.findIndex((i) => i.key === source);
    const columnTargetIndex = this.state.columns.findIndex((i) => i.key === target);

    cols.splice(columnTargetIndex, 0, cols.splice(columnSourceIndex, 1)[0]);
    if (this.props.settingsIdentifier) {
      const uiSettings: UiSettings = this.props.uiSettings || new LocalUiSettings();
      const keys = cols.map((col) => col.key);
      uiSettings.saveSetting(this.props.settingsIdentifier, "ColumnReorder", keys);
    }
    this.setState({ columns: [] }, () => { // fix react-data-grid update issues
      this.setState({ columns: cols });
    });
  }

  private cellEditOnClick(column: ReactDataGridColumn, _ev: React.SyntheticEvent<any>, args: { rowIdx: number, idx: number, name: string }): void {
    // Prevent editing when property record is not primitive
    if (this.state.rows[args.rowIdx]) {
      const record = this._getCellItem(this.state.rows[0].item, column.key).record;
      if (record && record.value.valueFormat !== PropertyValueFormat.Primitive)
        return;
    }

    let activate = false;

    const isSelected = this._selectedRowIndices.has(args.rowIdx);
    if (isSelected && this._pressedItemSelected)
      activate = true;

    if (activate)
      this.activateCellEditor(args.rowIdx, args.idx, column.key);
    else
      this._deactivateCellEditor();
  }

  private activateCellEditor(rowIndex: number, colIndex: number, cellKey: string): void {
    const cellEditorState = { active: true, rowIndex, colIndex, cellKey };
    if (cellEditorState !== this.state.cellEditorState) {
      this.setState(
        { cellEditorState },
        () => {
          if (this.props.onPropertyEditing)
            this.props.onPropertyEditing(cellEditorState);
        },
      );
    }
  }

  private _deactivateCellEditor = (): void => {
    if (this.state.cellEditorState.active)
      this.setState({ cellEditorState: { active: false } });
  }

  /** @internal */
  public shouldComponentUpdate(_props: TableProps): boolean {
    return true;
  }

  private _onCellCommit = async (args: PropertyUpdatedArgs) => {
    if (this.props.onPropertyUpdated) {
      const cellUpdatedArgs: TableCellUpdatedArgs = {
        rowIndex: this.state.cellEditorState.rowIndex!,
        colIndex: this.state.cellEditorState.colIndex!,
        cellKey: this.state.cellEditorState.cellKey!,
      };
      const allowed = await this.props.onPropertyUpdated(args, cellUpdatedArgs);
      if (allowed && this.state.cellEditorState.rowIndex !== undefined && this.state.cellEditorState.rowIndex >= 0) {
        this._deactivateCellEditor();
        await this.updateRows();
      } else {
        this._deactivateCellEditor();
      }
    }
  }

  private _getVisibleColumns = () => {
    return this.state.columns.filter((col) => this.state.hiddenColumns.indexOf(col.key) === -1);
  }

  private _showContextMenu = (e: React.MouseEvent) => {
    const header = e.currentTarget.querySelector(".react-grid-Header");
    // istanbul ignore else
    if (header) {
      const headerRect = header.getBoundingClientRect();
      const offsetY = headerRect.top;
      const height = headerRect.height;
      const x = e.clientX, y = e.clientY;
      if (y < offsetY + height) {
        e.preventDefault();
        this.setState({
          menuX: x, menuY: y,
          menuVisible: true,
        });
      }
    }
  }

  private _hideContextMenu = () => {
    // istanbul ignore else
    if (this.props.showHideColumns)
      this.setState({ menuVisible: false });
  }

  private _handleShowHideChange = (cols: string[]) => {
    this.setState({ hiddenColumns: cols });
    if (this.props.settingsIdentifier) {
      const uiSettings: UiSettings = this.props.uiSettings || new LocalUiSettings();
      uiSettings.saveSetting(this.props.settingsIdentifier, "ColumnShowHideHiddenColumns", cols);
    }
    return true;
  }

  private _onDialogOpen = (dialogState: PropertyDialogState) => this.setState({ dialog: dialogState });

  private _onDialogClose = () => this.setState({ dialog: undefined });

  // TODO: Enable, when table gets refactored. Explanation in ./../table/NonPrimitiveValueRenderer
  // private _onPopupShow = (popupState: PropertyPopupState) => this.setState({ popup: popupState });

  // private _onPopupHide = () =>  this.setState({ popup: undefined });

  /** @internal */
  public render() {
    const rowRenderer = <TableRowRenderer rowRendererCreator={() => this._createRowRenderer()} />;

    const visibleColumns = this._getVisibleColumns();
    return (
      <>
        <div className={classnames("components-table", this.props.hideHeader && "hide-header", this.props.className)} style={this.props.style}
          onMouseDown={this._onMouseDown} onContextMenu={this.props.showHideColumns ? this._showContextMenu : undefined}>
          {this.props.showHideColumns &&
            <ShowHideMenu
              opened={this.state.menuVisible}
              items={this.state.columns.map((column) => ({ id: column.key, label: column.name }))}
              x={this.state.menuX} y={this.state.menuY}
              initialHidden={this.state.hiddenColumns}
              onClose={this._hideContextMenu}
              onShowHideChange={this._handleShowHideChange} />
          }
          <ReactResizeDetector handleWidth handleHeight >
            {(width: number, height: number) =>
              <ReactDataGrid
                columns={visibleColumns}
                rowGetter={this._rowGetter}
                rowRenderer={rowRenderer}
                rowsCount={this.state.rowsCount}
                {...(this.props.reorderableColumns ? {
                  draggableHeaderCell: DragDropHeaderCell,
                  onHeaderDrop: this._onHeaderDrop,
                } as any : {})}
                minHeight={height}
                minWidth={width}
                headerRowHeight={TABLE_ROW_HEIGHT}
                rowHeight={TABLE_ROW_HEIGHT}
                onGridSort={this._handleGridSort}
              />}
          </ReactResizeDetector>
        </div>
        <div ref={this._tableRef}>
          {this.state.dialog
            ?
            <Dialog
              opened={true}
              onClose={this._onDialogClose}
              title={this.state.dialog.title}
              height={"50vh"}
            >
              {this.state.dialog.content}
            </Dialog>
            : undefined}
          {/* TODO: Enable, when table gets refactored. Explanation in ./../../properties/renderers/value/table/NonPrimitiveValueRenderer */}
          {/* {this.state.popup
            ?
            <Popup
              isShown={true}
              fixedPosition={this.state.popup.fixedPosition}
              position={Position.Top}
            >
              {this.state.popup.content}
            </Popup>
            :
            undefined} */}
        </div>
      </>
    );
  }
}

/**
 * Props for the [[TableRow]] component
 * @internal
 */
export interface TableRowProps extends CommonProps {
  cells: { [key: string]: React.ReactNode };
  isSelected?: boolean;
}

/**
 * Default component for rendering a row for the Table
 * @internal
 */
export class TableRow extends React.Component<TableRowProps> {

  /** @internal */
  public render() {
    const { cells, isSelected, ...props } = this.props;
    return (
      <ReactDataGrid.Row {...props} row={cells} isSelected={isSelected} />
    );
  }
}
