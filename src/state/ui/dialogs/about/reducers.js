import { combineReducers } from 'redux';

import {
  DIALOG_ACCOUNT_CLOSE,
  DIALOG_ACCOUNT_OPEN,
} from '../../../../constants/actions';

const open = (state = false, action) => {
  switch (action.type) {
    case DIALOG_ACCOUNT_CLOSE: return false;
    case DIALOG_ACCOUNT_OPEN: return true;
    default: return state;
  }
};

export default combineReducers({ open });
