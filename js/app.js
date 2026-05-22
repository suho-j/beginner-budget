/* beginner-budget-app app.js */
(function (window, document) {
  'use strict';

  let state = window.BudgetStorage.loadState();
  let elements;
  const MAX_IMPORT_BYTES = 1024 * 1024;

  function persist(nextState, options = {}) {
    const result = window.BudgetStorage.saveState(nextState);
    if (!result.ok) {
      state = result.state;
      render();
      window.BudgetUI.setMessage(
        options.messageElement || elements.toolMessage,
        '브라우저 저장소에 저장하지 못했어요. 공간/권한을 확인한 뒤 JSON 내보내기로 백업해 주세요.',
        'error'
      );
      return false;
    }
    state = result.state;
    render();
    return true;
  }

  function activeFilters() {
    return {
      month: elements.monthInput.value || window.BudgetStorage.localMonthString(),
      type: elements.filterType.value || 'all',
      query: elements.filterQuery.value || ''
    };
  }

  function render() {
    const filters = activeFilters();
    if (document.activeElement !== elements.budgetInput) {
      elements.budgetInput.value = state.monthlyBudget;
    }
    window.BudgetUI.syncCategoryBudgetInputs(elements, state.categoryBudgets);
    const summary = window.BudgetTransactions.summarize(state.transactions, state.monthlyBudget, filters.month, new Date(), state.categoryBudgets);
    const list = window.BudgetTransactions.filterTransactions(state.transactions, filters);
    window.BudgetUI.renderSummary(elements, summary, filters.month);
    window.BudgetUI.renderList(elements, list);
  }

  function handleBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.budgetForm);
    const result = window.BudgetTransactions.setMonthlyBudget(state, elements.budgetInput.valueAsNumber);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.budgetForm, elements.budgetMessage, result.errors);
      return;
    }
    if (persist(result.state, { messageElement: elements.budgetMessage })) {
      window.BudgetUI.setMessage(elements.budgetMessage, '월 예산을 저장했어요.', 'ok');
    }
  }

  function handleCategoryBudgetSubmit(event) {
    event.preventDefault();
    window.BudgetUI.clearFieldErrors(elements.categoryBudgetForm);
    const inputBudgets = window.BudgetUI.readCategoryBudgetInputs(elements);
    const result = window.BudgetTransactions.setCategoryBudgets(state, inputBudgets);
    if (!result.ok) {
      window.BudgetUI.showValidationErrors(elements.categoryBudgetForm, elements.categoryBudgetMessage, result.errors);
      return;
    }
    if (persist(result.state, { messageElement: elements.categoryBudgetMessage })) {
      window.BudgetUI.setMessage(elements.categoryBudgetMessage, '항목별 예산을 저장했어요.', 'ok');
    }
  }

  function handleTransactionSubmit(event) {
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
    if (persist(result.state, { messageElement: elements.formMessage })) {
      elements.transactionForm.reset();
      elements.dateInput.value = window.BudgetStorage.localDateString();
      elements.typeSelect.value = input.type;
      window.BudgetUI.fillCategoryOptions(elements.categorySelect, input.type);
      window.BudgetUI.setMessage(elements.formMessage, '거래를 추가했어요.', 'ok');
    }
  }

  function handleTypeChange() {
    window.BudgetUI.fillCategoryOptions(elements.categorySelect, elements.typeSelect.value);
  }

  function handleListClick(event) {
    const button = event.target.closest('.delete-button');
    if (!button) return;
    const tx = state.transactions.find((item) => item.id === button.dataset.id);
    const label = tx ? `${tx.date} ${tx.category} ${window.BudgetUI.formatWon(tx.amount)}` : '이 거래';
    if (!window.confirm(`${label} 내역을 삭제할까요?`)) return;
    if (persist(window.BudgetTransactions.deleteTransaction(state, button.dataset.id))) {
      window.BudgetUI.setMessage(elements.toolMessage, '거래를 삭제했어요.', 'ok');
    }
  }

  function handleSampleClick() {
    const month = elements.monthInput.value || window.BudgetStorage.localMonthString();
    const hasSample = window.BudgetTransactions.hasSampleForMonth(state.transactions, month);
    if (hasSample && !window.confirm('선택한 달에 이미 샘플 데이터가 있어요. 기존 샘플을 교체할까요?')) return;
    const nextState = window.BudgetTransactions.createSampleState(state, month, { replace: hasSample });
    if (persist(nextState)) {
      window.BudgetUI.setMessage(elements.toolMessage, hasSample ? '선택한 달의 샘플 데이터를 교체했어요.' : '선택한 달에 샘플 데이터를 추가했어요.', 'ok');
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
    reader.onload = () => {
      const result = window.BudgetTransactions.importState(String(reader.result || ''));
      if (!result.ok) {
        showImportError(result.errors.map((item) => item.message).join(' '));
        elements.importFile.value = '';
        return;
      }
      const skipped = result.summary && result.summary.skippedCount ? ` 유효하지 않은 ${result.summary.skippedCount}건은 제외됩니다.` : '';
      if (!window.confirm(`현재 데이터를 가져온 JSON 내용 ${result.summary.importedCount}건으로 교체할까요?${skipped}`)) {
        elements.importFile.value = '';
        return;
      }
      if (persist(result.state)) {
        window.BudgetUI.setMessage(elements.toolMessage, 'JSON 데이터를 가져왔어요.', 'ok');
      }
      elements.importFile.value = '';
    };
    reader.onerror = () => showImportError('파일을 읽지 못했어요.');
    reader.readAsText(file);
  }

  function handleResetClick() {
    if (!window.confirm('모든 가계부 데이터를 삭제하고 기본 예산으로 되돌릴까요?')) return;
    const result = window.BudgetStorage.resetState();
    if (!result.ok) {
      window.BudgetUI.setMessage(elements.toolMessage, '브라우저 저장소를 초기화하지 못했어요.', 'error');
      return;
    }
    state = result.state;
    elements.categoryBudgetFields.innerHTML = '';
    window.BudgetUI.initDefaults(elements, state);
    render();
    window.BudgetUI.setMessage(elements.toolMessage, '전체 데이터를 초기화했어요.', 'ok');
  }

  async function refreshCloudStatus() {
    try {
      const user = await window.BudgetCloud.currentUser();
      window.BudgetUI.updateCloudStatus(elements, user);
    } catch (error) {
      window.BudgetUI.updateCloudStatus(elements, null);
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 상태 확인 실패: ${error.message}`, 'error');
    }
  }

  async function handleCloudLogin(event) {
    event.preventDefault();
    const email = elements.cloudEmail.value.trim();
    if (!email) {
      window.BudgetUI.setMessage(elements.cloudMessage, '이메일을 입력해 주세요.', 'error');
      elements.cloudEmail.focus();
      return;
    }
    try {
      await window.BudgetCloud.signInWithEmail(email);
      window.BudgetUI.setMessage(elements.cloudMessage, '이메일로 로그인 링크를 보냈어요. 메일함을 확인해 주세요.', 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `로그인 링크 발송 실패: ${error.message}`, 'error');
    }
  }

  async function handleCloudUpload() {
    try {
      const result = await window.BudgetCloud.uploadState(state);
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드에 저장했어요. 거래 ${result.uploadedCount}건`, 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 저장 실패: ${error.message}`, 'error');
    }
  }

  async function handleCloudDownload() {
    if (!window.confirm('현재 브라우저 데이터를 클라우드 데이터로 교체할까요? 필요하면 먼저 JSON 내보내기로 백업하세요.')) return;
    try {
      const cloudState = await window.BudgetCloud.downloadState();
      if (persist(cloudState, { messageElement: elements.cloudMessage })) {
        window.BudgetUI.setMessage(elements.cloudMessage, '클라우드 데이터를 불러왔어요.', 'ok');
      }
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `클라우드 불러오기 실패: ${error.message}`, 'error');
    }
  }

  async function handleCloudLogout() {
    try {
      await window.BudgetCloud.signOut();
      await refreshCloudStatus();
      window.BudgetUI.setMessage(elements.cloudMessage, '로그아웃했어요.', 'ok');
    } catch (error) {
      window.BudgetUI.setMessage(elements.cloudMessage, `로그아웃 실패: ${error.message}`, 'error');
    }
  }

  function bindEvents() {
    elements.budgetForm.addEventListener('submit', handleBudgetSubmit);
    elements.categoryBudgetForm.addEventListener('submit', handleCategoryBudgetSubmit);
    elements.transactionForm.addEventListener('submit', handleTransactionSubmit);
    elements.typeSelect.addEventListener('change', handleTypeChange);
    elements.monthInput.addEventListener('change', render);
    elements.filterType.addEventListener('change', render);
    elements.filterQuery.addEventListener('input', render);
    elements.list.addEventListener('click', handleListClick);
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

  function init() {
    elements = window.BudgetUI.getElements();
    window.BudgetUI.initDefaults(elements, state);
    bindEvents();
    render();
    refreshCloudStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
