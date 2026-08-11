/* beginner-budget-app app.js */
(function (window, document) {
  'use strict';

  let state = window.BudgetStorage.loadState();
  let elements;
  const viewState = { tab: 'home', month: '', selectedDate: '' };
  const MAX_IMPORT_BYTES = 1024 * 1024;

  async function persistRemoteFirst(nextState, remoteAction, messageElement, busyButton = null) {
    if (busyButton) busyButton.disabled = true;
    try {
      await remoteAction();
      state = window.BudgetStorage.saveState(nextState).state;
      render();
      return true;
    } catch (error) {
      window.BudgetUI.setMessage(messageElement || elements.toolMessage, `Supabase 저장 실패: ${error.message}`, 'error');
      return false;
    } finally {
      if (busyButton) busyButton.disabled = false;
    }
  }

  function replaceAllRemoteFirst(nextState, messageElement, busyButton) {
    return persistRemoteFirst(
      nextState,
      () => window.BudgetCloud.uploadState(nextState),
      messageElement,
      busyButton
    );
  }

  function currentBudgetMonth() {
    return window.BudgetStorage.monthKeyForDate(window.BudgetStorage.localDateString(), state.monthStartDay || 1)
      || window.BudgetStorage.localMonthString();
  }

  function activeFilters() {
    return {
      month: viewState.month,
      monthStartDay: state.monthStartDay || 1,
      type: elements.filterType.value || 'all',
      category: elements.filterCategory.value || 'all',
      query: elements.filterQuery.value || ''
    };
  }

  function render() {
    const filters = activeFilters();
    elements.monthInput.value = viewState.month;
    const selectedBudget = window.BudgetStorage.budgetForMonth(state, filters.month);
    if (document.activeElement !== elements.monthStartInput) {
      elements.monthStartInput.value = state.monthStartDay || 1;
    }
    if (document.activeElement !== elements.budgetInput) {
      elements.budgetInput.value = selectedBudget.monthlyBudget;
    }
    window.BudgetUI.syncCategoryBudgetInputs(elements, selectedBudget.categoryBudgets);

    const period = window.BudgetStorage.periodRangeForMonth(filters.month, filters.monthStartDay);
    const summary = window.BudgetTransactions.summarize(
      state.transactions,
      selectedBudget.monthlyBudget,
      filters.month,
      new Date(),
      selectedBudget.categoryBudgets,
      filters.monthStartDay
    );
    const list = window.BudgetTransactions.filterTransactions(state.transactions, filters);
    const calendarDays = window.BudgetStorage.calendarDaysForBudgetMonth(filters.month, filters.monthStartDay);
    const transactionsByDate = window.BudgetTransactions.summarizeTransactionsByDate(
      state.transactions,
      filters.month,
      filters.monthStartDay
    );
    const selectedRows = viewState.selectedDate && transactionsByDate[viewState.selectedDate]
      ? transactionsByDate[viewState.selectedDate].transactions
      : [];

    window.BudgetUI.renderSummary(elements, summary, filters.month, period);
    window.BudgetUI.renderList(elements, list);
    window.BudgetUI.renderCalendar(elements, calendarDays, transactionsByDate, viewState.selectedDate);
    window.BudgetUI.renderCalendarDetails(elements, viewState.selectedDate, selectedRows);
    window.BudgetUI.setActiveTab(elements, viewState.tab);
    elements.calendarPeriodLabel.textContent = `${period.start} ~ ${period.end}`;
  }

  async function handleBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.budgetForm);
    const month = viewState.month;
    const result = window.BudgetTransactions.setMonthlyBudget(state, elements.budgetInput.valueAsNumber, month);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.budgetForm, elements.budgetMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.budgetMessage,
      event.submitter
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.budgetMessage, `${month} 예산을 저장했어요.`, 'ok');
    }
  }

  async function handleMonthStartSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.monthStartForm);
    const previousMonth = viewState.month;
    const previousSelectedDate = viewState.selectedDate;
    const result = window.BudgetTransactions.setMonthStartDay(state, elements.monthStartInput.valueAsNumber);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.monthStartForm, elements.monthStartMessage, result.errors);
      return;
    }

    viewState.month = window.BudgetStorage.monthKeyForDate(
      window.BudgetStorage.localDateString(),
      result.state.monthStartDay
    ) || window.BudgetStorage.localMonthString();
    viewState.selectedDate = '';
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.monthStartMessage,
      event.submitter
    );
    if (!saved) {
      viewState.month = previousMonth;
      viewState.selectedDate = previousSelectedDate;
      render();
      return;
    }
    window.BudgetUI.setMessage(elements.monthStartMessage, '월 시작일을 저장했어요.', 'ok');
  }

  async function handleCategoryBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.categoryBudgetForm);
    const month = viewState.month;
    const inputBudgets = window.BudgetUI.readCategoryBudgetInputs(elements);
    const result = window.BudgetTransactions.setCategoryBudgets(state, inputBudgets, month);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.categoryBudgetForm, elements.categoryBudgetMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.saveSettings(result.state),
      elements.categoryBudgetMessage,
      event.submitter
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.categoryBudgetMessage, `${month} 항목별 예산을 저장했어요.`, 'ok');
    }
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.transactionForm);
    const input = {
      date: elements.dateInput.value,
      type: elements.typeSelect.value,
      category: elements.categorySelect.value,
      amount: elements.amountInput.value,
      memo: elements.memoInput.value
    };
    const result = window.BudgetTransactions.addTransaction(state, input);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.transactionForm, elements.formMessage, result.errors);
      return;
    }
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.insertTransaction(result.transaction),
      elements.formMessage,
      event.submitter
    );
    if (!saved) return;

    elements.transactionForm.reset();
    elements.dateInput.value = window.BudgetStorage.localDateString();
    elements.typeSelect.value = input.type;
    window.BudgetUI.fillCategoryOptions(elements.categorySelect, input.type);
    window.BudgetUI.setMessage(elements.formMessage, '거래를 추가했어요.', 'ok');
  }

  function handleTypeChange() {
    window.BudgetUI.fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
  }

  async function handleTransactionAction(event) {
    const button = event.target.closest('[data-action][data-id]');
    if (!button) return;
    const transaction = state.transactions.find((item) => item.id === button.dataset.id);
    if (!transaction) return;

    if (button.dataset.action === 'edit') {
      window.BudgetUI.openEditDialog(elements, transaction, button);
      return;
    }
    if (button.dataset.action !== 'delete') return;

    const label = `${transaction.date} ${transaction.category} ${window.BudgetUI.formatWon(transaction.amount)}`;
    if (!window.confirm(`${label} 내역을 삭제할까요?`)) return;
    const nextState = window.BudgetTransactions.deleteTransaction(state, transaction.id);
    const saved = await persistRemoteFirst(
      nextState,
      () => window.BudgetCloud.deleteTransaction(transaction.id),
      elements.toolMessage,
      button
    );
    if (saved) {
      window.BudgetUI.setMessage(elements.toolMessage, '거래를 삭제했어요.', 'ok');
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.editForm);
    const result = window.BudgetTransactions.updateTransaction(state, elements.editId.value, {
      date: elements.editDate.value,
      type: elements.editType.value,
      category: elements.editCategory.value,
      amount: elements.editAmount.value,
      memo: elements.editMemo.value
    });
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.editForm, elements.editMessage, result.errors);
      return;
    }

    const movedOutsideSelectedMonth = !window.BudgetStorage.isDateInBudgetMonth(
      result.transaction.date,
      viewState.month,
      state.monthStartDay || 1
    );
    const saved = await persistRemoteFirst(
      result.state,
      () => window.BudgetCloud.updateTransaction(result.transaction),
      elements.editMessage,
      elements.editSave
    );
    if (!saved) return;

    window.BudgetUI.closeEditDialog(elements);
    window.BudgetUI.setMessage(
      elements.toolMessage,
      movedOutsideSelectedMonth
        ? '거래를 수정했어요. 수정한 날짜가 선택한 달 밖이라 목록에서 이동했어요.'
        : '거래를 수정했어요.',
      'ok'
    );
  }

  function changeMonth(delta) {
    viewState.month = window.BudgetStorage.addMonthsToMonth(viewState.month, delta);
    viewState.selectedDate = '';
    render();
  }

  function selectTab(tab, focus = false) {
    viewState.tab = tab;
    window.BudgetUI.setActiveTab(elements, tab, focus);
  }

  function handleTabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = elements.tabs.indexOf(event.currentTarget);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? elements.tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + elements.tabs.length) % elements.tabs.length;
    selectTab(elements.tabs[nextIndex].dataset.tab, true);
  }

  async function handleSampleClick(event) {
    const month = viewState.month;
    const monthStartDay = state.monthStartDay || 1;
    const hasSample = window.BudgetTransactions.hasSampleForMonth(state.transactions, month, monthStartDay);
    if (hasSample && !window.confirm('선택한 달에 이미 샘플 데이터가 있어요. 기존 샘플만 교체할까요?')) return;

    const preparedState = window.BudgetTransactions.createSampleState(state, month, { replace: hasSample });
    const existingIds = new Set(state.transactions.map((transaction) => transaction.id));
    const previousSampleIds = state.transactions
      .filter((transaction) => (
        transaction.source === 'sample'
        && window.BudgetStorage.isDateInBudgetMonth(transaction.date, month, monthStartDay)
      ))
      .map((transaction) => transaction.id);
    const previousSampleIdSet = new Set(previousSampleIds);
    const newSampleRows = preparedState.transactions.filter((transaction) => (
      transaction.source === 'sample' && !existingIds.has(transaction.id)
    ));
    const nextState = {
      ...preparedState,
      transactions: preparedState.transactions.filter((transaction) => !previousSampleIdSet.has(transaction.id))
    };
    const insertedIds = [];
    const button = event.currentTarget;
    button.disabled = true;

    try {
      for (const transaction of newSampleRows) {
        await window.BudgetCloud.insertTransaction(transaction);
        insertedIds.push(transaction.id);
      }
      for (const id of previousSampleIds) {
        await window.BudgetCloud.deleteTransaction(id);
      }
      state = window.BudgetStorage.saveState(nextState).state;
      render();
      window.BudgetUI.setMessage(
        elements.toolMessage,
        hasSample ? '선택한 달의 샘플 데이터를 교체했어요.' : '선택한 달에 샘플 데이터를 추가했어요.',
        'ok'
      );
    } catch (error) {
      for (const id of insertedIds) {
        try {
          await window.BudgetCloud.deleteTransaction(id);
        } catch (cleanupError) {
          window.console.error('샘플 정리 실패', cleanupError);
        }
      }
      try {
        const cloudState = await window.BudgetCloud.downloadState();
        applyDownloadedState(cloudState);
      } catch (reloadError) {
        window.console.error('샘플 재동기화 실패', reloadError);
      }
      window.BudgetUI.setMessage(elements.toolMessage, `샘플 저장 실패: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function handleExportClick() {
    const filename = `beginner-budget-${window.BudgetStorage.localDateString()}.json`;
    window.BudgetUI.downloadText(filename, window.BudgetTransactions.exportState(state));
    window.BudgetUI.setMessage(elements.toolMessage, 'JSON 백업 파일을 내보냈어요.', 'ok');
  }

  function handleImportClick() {
    elements.importFile.setAttribute('aria-invalid', 'false');
    elements.importFile.click();
  }

  function showImportError(message) {
    elements.importFile.setAttribute('aria-invalid', 'true');
    window.BudgetUI.setMessage(elements.toolMessage, message, 'error');
    elements.importButton.focus();
  }

  function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showImportError('1MB 이하의 JSON 백업 파일만 가져올 수 있어요.');
      elements.importFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const result = window.BudgetTransactions.importState(String(reader.result || ''));
      if (!result.ok) {
        showImportError(result.errors.map((item) => item.message).join(' '));
        elements.importFile.value = '';
        return;
      }
      const skipped = result.summary && result.summary.skippedCount
        ? ` 유효하지 않은 ${result.summary.skippedCount}건은 제외됩니다.`
        : '';
      if (!window.confirm(`현재 데이터를 가져온 JSON 내용 ${result.summary.importedCount}건으로 교체할까요?${skipped}`)) {
        elements.importFile.value = '';
        return;
      }
      const saved = await replaceAllRemoteFirst(result.state, elements.toolMessage, elements.importButton);
      if (saved) {
        window.BudgetUI.setMessage(elements.toolMessage, 'JSON 데이터를 가져왔어요.', 'ok');
      }
      elements.importFile.value = '';
    };
    reader.onerror = () => showImportError('파일을 읽지 못했어요.');
    reader.readAsText(file);
  }

  async function handleResetClick(event) {
    if (!window.confirm('모든 가계부 데이터를 삭제하고 기본 예산으로 되돌릴까요?')) return;
    const result = window.BudgetStorage.resetState();
    if (!result.ok) {
      window.BudgetUI.setMessage(elements.toolMessage, '초기화할 데이터를 준비하지 못했어요.', 'error');
      return;
    }
    const saved = await replaceAllRemoteFirst(result.state, elements.toolMessage, event.currentTarget);
    if (!saved) return;

    elements.categoryBudgetFields.innerHTML = '';
    window.BudgetUI.initDefaults(elements, state);
    viewState.month = currentBudgetMonth();
    viewState.selectedDate = '';
    render();
    window.BudgetUI.setMessage(elements.toolMessage, '전체 데이터를 초기화하고 Supabase에 저장했어요.', 'ok');
  }

  function applyDownloadedState(cloudState) {
    state = window.BudgetStorage.saveState(cloudState).state;
    viewState.month = currentBudgetMonth();
    viewState.selectedDate = '';
    render();
  }

  async function refreshCloudStatus() {
    try {
      const user = await window.BudgetCloud.currentUser();
      window.BudgetUI.updateCloudStatus(elements, user);
      return user;
    } catch (error) {
      window.BudgetUI.updateCloudStatus(elements, null);
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 상태 확인 실패: ${error.message}`, 'error');
      return null;
    }
  }

  async function loadCloudStateForSignedInUser() {
    const user = await refreshCloudStatus();
    if (!user) return false;
    try {
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
      return true;
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 불러오기 실패: ${error.message}`, 'error');
      return false;
    }
  }

  async function handleCloudLogin(event) {
    event.preventDefault();
    const password = elements.cloudPassword.value;
    if (!password) {
      window.BudgetUI.setMessage(elements.cloudMessage, '비밀번호를 입력해 주세요.', 'error');
      elements.cloudPassword.focus();
      return;
    }
    try {
      await window.BudgetCloud.signInWithPassword(password);
      elements.cloudPassword.value = '';
      await refreshCloudStatus();
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      window.BudgetUI.setMessage(elements.cloudMessage, '로그인하고 클라우드 데이터를 불러왔어요.', 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 실패: ${error.message}`, 'error');
    }
  }

  async function handleCloudUpload(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.BudgetCloud.uploadState(state);
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드에 저장했어요. 거래 ${result.uploadedCount}건`, 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 저장 실패: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function handleCloudDownload(event) {
    if (!window.confirm('현재 화면을 최신 클라우드 데이터로 다시 불러올까요?')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const cloudState = await window.BudgetCloud.downloadState();
      applyDownloadedState(cloudState);
      window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 불러오기 실패: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function handleCloudLogout(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await window.BudgetCloud.signOut();
      await refreshCloudStatus();
      window.BudgetUI.setMessage(elements.cloudMessage, '로그아웃했어요.', 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `로그아웃 실패: ${error.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
      tab.addEventListener('keydown', handleTabKeydown);
    });
    elements.previousMonthButton.addEventListener('click', () => changeMonth(-1));
    elements.nextMonthButton.addEventListener('click', () => changeMonth(1));
    elements.currentMonthButton.addEventListener('click', () => {
      viewState.month = currentBudgetMonth();
      viewState.selectedDate = '';
      render();
    });
    elements.monthInput.addEventListener('change', () => {
      if (!window.BudgetStorage.isValidMonthString(elements.monthInput.value)) {
        elements.monthInput.value = viewState.month;
        return;
      }
      viewState.month = elements.monthInput.value;
      viewState.selectedDate = '';
      render();
    });
    elements.filterType.addEventListener('change', () => {
      window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, elements.filterType.value, 'all');
      render();
    });
    elements.filterCategory.addEventListener('change', render);
    elements.filterQuery.addEventListener('input', render);

    elements.monthStartForm.addEventListener('submit', handleMonthStartSubmit);
    elements.budgetForm.addEventListener('submit', handleBudgetSubmit);
    elements.categoryBudgetForm.addEventListener('submit', handleCategoryBudgetSubmit);
    elements.transactionForm.addEventListener('submit', handleTransactionSubmit);
    elements.typeSelect.addEventListener('change', handleTypeChange);
    elements.list.addEventListener('click', handleTransactionAction);
    elements.calendarDetailList.addEventListener('click', handleTransactionAction);
    elements.calendarGrid.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="select-date"]');
      if (!button || button.disabled) return;
      viewState.selectedDate = button.dataset.date;
      render();
    });

    elements.editForm.addEventListener('submit', handleEditSubmit);
    elements.editType.addEventListener('change', () => {
      window.BudgetUI.fillCategoryOptions(elements.editCategory, elements.editType.value);
    });
    [elements.editClose, elements.editCancel].forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        window.BudgetUI.closeEditDialog(elements);
      });
    });
    elements.editDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      window.BudgetUI.closeEditDialog(elements);
    });

    elements.sampleButton.addEventListener('click', handleSampleClick);
    elements.exportButton.addEventListener('click', handleExportClick);
    elements.importButton.addEventListener('click', handleImportClick);
    elements.importFile.addEventListener('change', handleImportFile);
    elements.resetButton.addEventListener('click', handleResetClick);
    elements.cloudLoginForm.addEventListener('submit', handleCloudLogin);
    elements.cloudUploadButton.addEventListener('click', handleCloudUpload);
    elements.cloudDownloadButton.addEventListener('click', handleCloudDownload);
    elements.cloudLogoutButton.addEventListener('click', handleCloudLogout);
    elements.transactionForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        elements.dateInput.value = window.BudgetStorage.localDateString();
        window.BudgetUI.fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
        window.BudgetUI.clearFieldErrors(elements.transactionForm);
        window.BudgetUI.setMessage(elements.formMessage, '', null);
      }, 0);
    });
  }

  async function init() {
    elements = window.BudgetUI.getElements();
    window.BudgetUI.initDefaults(elements, state);
    viewState.month = currentBudgetMonth();
    window.BudgetUI.fillFilterCategoryOptions(elements.filterCategory, 'all', 'all');
    const previewPath = window.location.pathname.startsWith('/beginner-budget-preview/');
    elements.previewDataWarning.hidden = !previewPath;
    document.body.classList.toggle('has-preview-warning', previewPath);
    bindEvents();
    const loaded = await loadCloudStateForSignedInUser();
    if (!loaded) render();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
