'use strict';

angular.module('copayApp.controllers').controller('confirmController', function($rootScope, $scope, $interval, $filter, $timeout, $ionicScrollDelegate, gettextCatalog, walletService, platformInfo, lodash, configService, rateService, $stateParams, $window, $state, $log, profileService, bitcore, txFormatService, ongoingProcess, $ionicModal, popupService, $ionicHistory, $ionicConfig, payproService, feeService, amazonService, glideraService, bwcError, bitpayCardService) {
  var cachedTxp = {};
  var toAmount;
  var isChromeApp = platformInfo.isChromeApp;
  var countDown = null;
  var giftCardAmountUSD;
  var giftCardAccessKey;
  var giftCardInvoiceTime;
  var giftCardUUID;
  var cachedSendMax = {};
  $scope.isCordova = platformInfo.isCordova;
  $ionicConfig.views.swipeBackEnabled(false);

  $scope.$on("$ionicView.beforeEnter", function(event, data) {
    // Amazon.com Gift Card parameters
    $scope.isGiftCard = data.stateParams.isGiftCard;
    giftCardAmountUSD = data.stateParams.giftCardAmountUSD;
    giftCardAccessKey = data.stateParams.giftCardAccessKey;
    giftCardInvoiceTime = data.stateParams.giftCardInvoiceTime;
    giftCardUUID = data.stateParams.giftCardUUID;

    // Glidera parameters
    $scope.isGlidera = data.stateParams.isGlidera;
    $scope.glideraAccessToken = data.stateParams.glideraAccessToken;

    toAmount = data.stateParams.toAmount;
    cachedSendMax = {};
    $scope.useSendMax = data.stateParams.useSendMax == 'true' ? true : false;
    var isWallet = data.stateParams.isWallet || 'false';
    $scope.isWallet = (isWallet.toString().trim().toLowerCase() == 'true' ? true : false);
    $scope.cardId = data.stateParams.cardId;
    $scope.cardAmountUSD = data.stateParams.cardAmountUSD;
    $scope.toAddress = data.stateParams.toAddress;
    $scope.toName = data.stateParams.toName;
    $scope.toEmail = data.stateParams.toEmail;
    $scope.description = data.stateParams.description;
    $scope.paypro = data.stateParams.paypro;
    $scope.insufficientFunds = false;
    $scope.noMatchingWallet = false;
    $scope.paymentExpired = {
      value: false
    };
    $scope.remainingTimeStr = {
      value: null
    };

    var config = configService.getSync().wallet;
    var feeLevel = config.settings && config.settings.feeLevel ? config.settings.feeLevel : 'normal';
    $scope.feeLevel = feeService.feeOpts[feeLevel];
    if ($scope.isGlidera) $scope.network = glideraService.getEnvironment();
    else $scope.network = (new bitcore.Address($scope.toAddress)).network.name;
    resetValues();
    setwallets();
    applyButtonText();
  });

  function applyButtonText(multisig) {
    $scope.buttonText = $scope.isCordova ? gettextCatalog.getString('Slide') + ' ' : gettextCatalog.getString('Click') + ' ';

    if ($scope.isGlidera || $scope.isGiftCard || $scope.cardId) {
      $scope.buttonText += gettextCatalog.getString('to complete');
    } else if ($scope.paypro) {
      $scope.buttonText += gettextCatalog.getString('to pay');
    } else if (multisig) {
      $scope.buttonText += gettextCatalog.getString('to accept');
    } else
      $scope.buttonText += gettextCatalog.getString('to send');
  };

  function setwallets() {
    $scope.wallets = profileService.getWallets({
      onlyComplete: true,
      network: $scope.network
    });

    if (!$scope.wallets || !$scope.wallets.length) {
      $scope.noMatchingWallet = true;
      displayValues();
      $log.warn('No ' + $scope.network + ' wallets to make the payment');
      $timeout(function() {
        $scope.$apply();
      });
      return;
    }

    if ($scope.isGlidera == 'buy') {
      initConfirm();
      return;
    }

    var filteredWallets = [];
    var index = 0;
    var enoughFunds = false;
    var walletsUpdated = 0;

    lodash.each($scope.wallets, function(w) {
      walletService.getStatus(w, {}, function(err, status) {
        if (err || !status) {
          $log.error(err);
        } else {
          walletsUpdated++;
          w.status = status;
          if (!status.availableBalanceSat) $log.debug('No balance available in: ' + w.name);
          if (status.availableBalanceSat > toAmount) {
            filteredWallets.push(w);
            enoughFunds = true;
          }
        }

        if (++index == $scope.wallets.length) {

          if (!lodash.isEmpty(filteredWallets)) {
            $scope.wallets = lodash.clone(filteredWallets);
            if ($scope.useSendMax) {
              if ($scope.wallets.length > 1)
                $scope.showWalletSelector();
              else {
                $scope.wallet = $scope.wallets[0];
                $scope.getSendMaxInfo();
              }
            } else initConfirm();
          } else {

            // Were we able to update any wallet?
            if (walletsUpdated) {
              if (!enoughFunds) $scope.insufficientFunds = true;
              displayValues();
              $log.warn('No wallet available to make the payment');
            } else {
              popupService.showAlert(gettextCatalog.getString('Could not update wallets'), bwcError.msg(err), function() {
                $ionicHistory.nextViewOptions({
                  disableAnimate: true,
                  historyRoot: true
                });
                $ionicHistory.clearHistory();
                $state.go('tabs.send');
              });
            }

          }
          $timeout(function() {
            $scope.$apply();
          });
        }
      });
    });
  };

  var initConfirm = function() {
    if ($scope.paypro) _paymentTimeControl($scope.paypro.expires);

    displayValues();
    if ($scope.wallets.length > 1) $scope.showWalletSelector();
    else setWallet($scope.wallets[0]);
    $timeout(function() {
      $scope.$apply();
    });
  };

  function displayValues() {
    toAmount = parseInt(toAmount);
    $scope.amountStr = txFormatService.formatAmountStr(toAmount);
    $scope.displayAmount = getDisplayAmount($scope.amountStr);
    $scope.displayUnit = getDisplayUnit($scope.amountStr);
    if ($scope.cardAmountUSD) {
      $scope.alternativeAmountStr = $filter('formatFiatAmount')($scope.cardAmountUSD) + ' USD';
    } else if ($scope.giftCardAmountUSD) {
      $scope.alternativeAmountStr = $filter('formatFiatAmount')($scope.giftCardAmountUSD) + ' USD';
    } else {
      txFormatService.formatAlternativeStr(toAmount, function(v) {
        $scope.alternativeAmountStr = v;
      });
    }
    if ($scope.isGlidera == 'buy') $scope.getBuyPrice();
    if ($scope.isGlidera == 'sell') $scope.getSellPrice();
  };

  function resetValues() {
    $scope.displayAmount = $scope.displayUnit = $scope.fee = $scope.alternativeAmountStr = $scope.insufficientFunds = $scope.noMatchingWallet = null;
  };

  $scope.getSendMaxInfo = function() {
    resetValues();

    ongoingProcess.set('gettingFeeLevels', true);
    feeService.getCurrentFeeValue($scope.network, function(err, feePerKb) {
      ongoingProcess.set('gettingFeeLevels', false);
      if (err) {
        popupService.showAlert(gettextCatalog.getString('Error'), err.message);
        return;
      }
      var config = configService.getSync().wallet;

      ongoingProcess.set('retrievingInputs', true);
      walletService.getSendMaxInfo($scope.wallet, {
        feePerKb: feePerKb,
        excludeUnconfirmedUtxos: !config.spendUnconfirmed,
        returnInputs: true,
      }, function(err, resp) {
        ongoingProcess.set('retrievingInputs', false);
        if (err) {
          popupService.showAlert(gettextCatalog.getString('Error'), err);
          return;
        }

        if (resp.amount == 0) {
          $scope.insufficientFunds = true;
          popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Not enough funds for fee'));
          return;
        }

        $scope.sendMaxInfo = {
          sendMax: true,
          amount: resp.amount,
          inputs: resp.inputs,
          fee: resp.fee,
          feePerKb: feePerKb,
        };

        cachedSendMax[$scope.wallet.id] = $scope.sendMaxInfo;

        var msg = gettextCatalog.getString("{{fee}} will be deducted for bitcoin networking fees.", {
          fee: txFormatService.formatAmountStr(resp.fee)
        });
        var warningMsg = verifyExcludedUtxos();

        if (!lodash.isEmpty(warningMsg))
          msg += '\n' + warningMsg;

        popupService.showAlert(null, msg, function() {
          setSendMaxValues(resp);

          createTx($scope.wallet, true, function(err, txp) {
            if (err) return;
            cachedTxp[$scope.wallet.id] = txp;
            apply(txp);
          });
        });

        function verifyExcludedUtxos() {
          var warningMsg = [];
          if (resp.utxosBelowFee > 0) {
            warningMsg.push(gettextCatalog.getString("A total of {{amountBelowFeeStr}} were excluded. These funds come from UTXOs smaller than the network fee provided.", {
              amountBelowFeeStr: txFormatService.formatAmountStr(resp.amountBelowFee)
            }));
          }

          if (resp.utxosAboveMaxSize > 0) {
            warningMsg.push(gettextCatalog.getString("A total of {{amountAboveMaxSizeStr}} were excluded. The maximum size allowed for a transaction was exceeded.", {
              amountAboveMaxSizeStr: txFormatService.formatAmountStr(resp.amountAboveMaxSize)
            }));
          }
          return warningMsg.join('\n');
        };
      });
    });
  };

  function setSendMaxValues(data) {
    resetValues();
    var config = configService.getSync().wallet;
    var unitToSatoshi = config.settings.unitToSatoshi;
    var satToUnit = 1 / unitToSatoshi;
    var unitDecimals = config.settings.unitDecimals;

    $scope.amountStr = txFormatService.formatAmountStr(data.amount, true);
    $scope.displayAmount = getDisplayAmount($scope.amountStr);
    $scope.displayUnit = getDisplayUnit($scope.amountStr);
    $scope.fee = txFormatService.formatAmountStr(data.fee);
    toAmount = parseFloat((data.amount * satToUnit).toFixed(unitDecimals));
    txFormatService.formatAlternativeStr(data.amount, function(v) {
      $scope.alternativeAmountStr = v;
    });
    $timeout(function() {
      $scope.$apply();
    });
  };

  $scope.$on('accepted', function(event) {
    $scope.approve();
  });

  $scope.showWalletSelector = function() {
    $scope.walletSelectorTitle = $scope.isGlidera == 'buy' ? 'Receive in' : $scope.isGlidera == 'sell' ? 'Sell From' : gettextCatalog.getString('Send from');
    if (!$scope.useSendMax && ($scope.insufficientFunds || $scope.noMatchingWallet)) return;
    $scope.showWallets = true;
  };

  $scope.onWalletSelect = function(wallet) {
    if ($scope.useSendMax) {
      $scope.wallet = wallet;
      if (cachedSendMax[wallet.id]) {
        $log.debug('Send max cached for wallet:', wallet.id);
        setSendMaxValues(cachedSendMax[wallet.id]);
        return;
      }
      $scope.getSendMaxInfo();
    } else
      setWallet(wallet);

    applyButtonText(wallet.credentials.m > 1);
  };

  $scope.showDescriptionPopup = function() {
    var message = gettextCatalog.getString('Add description');
    var opts = {
      defaultText: $scope.description
    };

    popupService.showPrompt(null, message, opts, function(res) {
      if (typeof res != 'undefined') $scope.description = res;
      $timeout(function() {
        $scope.$apply();
      });
    });
  };

  function getDisplayAmount(amountStr) {
    return $scope.amountStr.split(' ')[0];
  };

  function getDisplayUnit(amountStr) {
    return $scope.amountStr.split(' ')[1];
  };

  function _paymentTimeControl(expirationTime) {
    $scope.paymentExpired.value = false;
    setExpirationTime();

    countDown = $interval(function() {
      setExpirationTime();
    }, 1000);

    function setExpirationTime() {
      var now = Math.floor(Date.now() / 1000);

      if (now > expirationTime) {
        setExpiredValues();
        return;
      }

      var totalSecs = expirationTime - now;
      var m = Math.floor(totalSecs / 60);
      var s = totalSecs % 60;
      $scope.remainingTimeStr.value = ('0' + m).slice(-2) + ":" + ('0' + s).slice(-2);
    };

    function setExpiredValues() {
      $scope.paymentExpired.value = true;
      $scope.remainingTimeStr.value = gettextCatalog.getString('Expired');
      if (countDown) $interval.cancel(countDown);
      $timeout(function() {
        $scope.$apply();
      });
    };
  };

  function setWallet(wallet, delayed) {
    var stop;
    $scope.wallet = wallet;
    $scope.fee = $scope.txp = null;

    if ($scope.isGlidera) return;
    if (stop) {
      $timeout.cancel(stop);
      stop = null;
    }

    if (cachedTxp[wallet.id]) {
      apply(cachedTxp[wallet.id]);
    } else {
      stop = $timeout(function() {
        createTx(wallet, true, function(err, txp) {
          if (err) return;
          cachedTxp[wallet.id] = txp;
          apply(txp);
        });
      }, delayed ? 2000 : 1);
    }

    $timeout(function() {
      $ionicScrollDelegate.resize();
      $scope.$apply();
    }, 10);
  };

  var setSendError = function(msg) {
    $scope.sendStatus = '';
    $timeout(function() {
      $scope.$apply();
    });
    popupService.showAlert(gettextCatalog.getString('Error at confirm'), bwcError.msg(msg));
  };

  function apply(txp) {
    $scope.fee = txFormatService.formatAmountStr(txp.fee);
    $scope.txp = txp;
    $timeout(function() {
      $scope.$apply();
    });
  };

  var createTx = function(wallet, dryRun, cb) {
    var config = configService.getSync().wallet;
    var currentSpendUnconfirmed = config.spendUnconfirmed;
    var paypro = $scope.paypro;
    var toAddress = $scope.toAddress;
    var description = $scope.description;
    var unitToSatoshi = config.settings.unitToSatoshi;
    var unitDecimals = config.settings.unitDecimals;

    // ToDo: use a credential's (or fc's) function for this
    if (description && !wallet.credentials.sharedEncryptingKey) {
      var msg = gettextCatalog.getString('Could not add message to imported wallet without shared encrypting key');
      $log.warn(msg);
      return setSendError(msg);
    }

    if (toAmount > Number.MAX_SAFE_INTEGER) {
      var msg = gettextCatalog.getString('Amount too big');
      $log.warn(msg);
      return setSendError(msg);
    }

    var txp = {};
    var amount;

    if ($scope.useSendMax) amount = parseFloat((toAmount * unitToSatoshi).toFixed(0));
    else amount = toAmount;

    txp.outputs = [{
      'toAddress': toAddress,
      'amount': amount,
      'message': description
    }];

    if ($scope.sendMaxInfo) {
      txp.inputs = $scope.sendMaxInfo.inputs;
      txp.fee = $scope.sendMaxInfo.fee;
    } else
      txp.feeLevel = config.settings && config.settings.feeLevel ? config.settings.feeLevel : 'normal';

    txp.message = description;

    if (paypro) {
      txp.payProUrl = paypro.url;
    }
    txp.excludeUnconfirmedUtxos = !currentSpendUnconfirmed;
    txp.dryRun = dryRun;

    walletService.createTx(wallet, txp, function(err, ctxp) {
      if (err) {
        setSendError(err);
        return cb(err);
      }
      return cb(null, ctxp);
    });
  };

  $scope.openPPModal = function() {
    $ionicModal.fromTemplateUrl('views/modals/paypro.html', {
      scope: $scope
    }).then(function(modal) {
      $scope.payproModal = modal;
      $scope.payproModal.show();
    });
  };

  $scope.cancel = function() {
    $scope.payproModal.hide();
  };

  $scope.approve = function(onSendStatusChange) {

    var wallet = $scope.wallet;
    if (!wallet) {
      return;
    }

    if ($scope.paypro && $scope.paymentExpired.value) {
      popupService.showAlert(null, gettextCatalog.getString('This bitcoin payment request has expired.'));
      $scope.sendStatus = '';
      $timeout(function() {
        $scope.$apply();
      });
      return;
    }

    if ($scope.isGlidera) {
      $scope.get2faCode(function(err, sent) {
        if (err) {
          popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Could not send confirmation code to your phone'));
          return;
        }
        if (sent) {
          var title = gettextCatalog.getString("Please, enter the code below");
          var message = gettextCatalog.getString("A SMS containing a confirmation code was sent to your phone.");
          popupService.showPrompt(title, message, null, function(twoFaCode) {
            if (typeof twoFaCode == 'undefined') return;
            if ($scope.isGlidera == 'buy') {
              $scope.buyRequest(wallet, twoFaCode, function(err, data) {
                if (err) {
                  popupService.showAlert(gettextCatalog.getString('Error'), err);
                  return;
                }
                $scope.sendStatus = 'success';
                $timeout(function() {
                  $scope.$digest();
                });
              })
            }
            if ($scope.isGlidera == 'sell') {
              $scope.sellRequest(wallet, twoFaCode, function(err, data) {
                if (err) {
                  popupService.showAlert(gettextCatalog.getString('Error'), err);
                  return;
                }
                $scope.sendStatus = 'success';
                $timeout(function() {
                  $scope.$digest();
                });
              })
            }
          });
        }
      });
      return;
    }
 
    ongoingProcess.set('creatingTx', true, onSendStatusChange);
    createTx(wallet, false, function(err, txp) {
      ongoingProcess.set('creatingTx', false, onSendStatusChange);
      if (err) return;

      var config = configService.getSync();
      var spendingPassEnabled = walletService.isEncrypted(wallet);
      var touchIdEnabled = config.touchIdFor && config.touchIdFor[wallet.id];
      var isCordova = $scope.isCordova;
      var bigAmount = parseFloat(txFormatService.formatToUSD(txp.amount)) > 20;
      var message = gettextCatalog.getString('Sending {{amountStr}} from your {{name}} wallet', {
        amountStr: $scope.amountStr,
        name: wallet.name
      });
      var okText = gettextCatalog.getString('Confirm');
      var cancelText = gettextCatalog.getString('Cancel');

      if (!spendingPassEnabled && !touchIdEnabled) {
        if (isCordova) {
          if (bigAmount) {
            popupService.showConfirm(null, message, okText, cancelText, function(ok) {
              if (!ok) {
                $scope.sendStatus = '';
                $timeout(function() {
                  $scope.$apply();
                });
                return;
              }
              publishAndSign(wallet, txp, onSendStatusChange);
            });
          } else publishAndSign(wallet, txp, onSendStatusChange);
        } else {
          popupService.showConfirm(null, message, okText, cancelText, function(ok) {
            if (!ok) {
              $scope.sendStatus = '';
              return;
            }
            publishAndSign(wallet, txp, onSendStatusChange);
          });
        }
      } else publishAndSign(wallet, txp, onSendStatusChange);
    });
  };

  function statusChangeHandler(processName, showName, isOn) {
    $log.debug('statusChangeHandler: ', processName, showName, isOn);
    if (
      (
        processName === 'broadcastingTx' || 
        ((processName === 'signingTx') && $scope.wallet.m > 1) || 
        (processName == 'sendingTx' && !$scope.wallet.canSign() && !$scope.wallet.isPrivKeyExternal())
      ) && !isOn) {
      $scope.sendStatus = 'success';
      $timeout(function() {
        $scope.$digest();
      }, 100);
    } else if (showName) {
      $scope.sendStatus = showName;
    }
  };

  $scope.statusChangeHandler = statusChangeHandler;

  $scope.onConfirm = function() {
    $scope.approve(statusChangeHandler);
  };

  $scope.onSuccessConfirm = function() {
    var previousView = $ionicHistory.viewHistory().backView && $ionicHistory.viewHistory().backView.stateName;
    var fromBitPayCard = previousView.match(/tabs.bitpayCard/) ? true : false;
    var fromAmazon = previousView.match(/tabs.giftcards.amazon/) ? true : false;
    var fromGlidera = previousView.match(/tabs.buyandsell.glidera/) ? true : false;

    $ionicHistory.nextViewOptions({
      disableAnimate: true
    });
    $ionicHistory.removeBackView();
    $scope.sendStatus = '';

    if (fromBitPayCard) {
      $timeout(function() {
        $state.transitionTo('tabs.bitpayCard', {
          id: $stateParams.cardId
        });
      }, 100);
    } else if (fromAmazon) {
      $ionicHistory.nextViewOptions({
        disableAnimate: true,
        historyRoot: true
      });
      $ionicHistory.clearHistory();
      $state.go('tabs.home').then(function() {
        $state.transitionTo('tabs.giftcards.amazon', {
          cardClaimCode: $scope.amazonGiftCard ? $scope.amazonGiftCard.claimCode : null
        });
      });
    } else if (fromGlidera) {
      $ionicHistory.nextViewOptions({
        disableAnimate: true,
        historyRoot: true
      });
      $ionicHistory.clearHistory();
      $state.go('tabs.home').then(function() {
        $state.transitionTo('tabs.buyandsell.glidera');
      });
    } else {
      $ionicHistory.nextViewOptions({
        disableAnimate: true,
        historyRoot: true
      });
      $ionicHistory.clearHistory();
      $state.go('tabs.send').then(function() {
        $state.transitionTo('tabs.home');
      });
    }
  };

  $scope.get2faCode = function(cb) {
    ongoingProcess.set('sending2faCode', true);
    $timeout(function() {
      glideraService.get2faCode($scope.glideraAccessToken, function(err, sent) {
        ongoingProcess.set('sending2faCode', false);
        return cb(err, sent);
      });
    }, 100);
  };

  $scope.buyRequest = function(wallet, twoFaCode, cb) {
    ongoingProcess.set('buyingBitcoin', true);
    $timeout(function() {
      walletService.getAddress(wallet, false, function(err, walletAddr) {
        if (err) {
          ongoingProcess.set('buyingBitcoin', false);
          popupService.showAlert(gettextCatalog.getString('Error'), bwcError.cb(err, 'Could not create address'));
          return;
        }
        var data = {
          destinationAddress: walletAddr,
          qty: $scope.buyPrice.qty,
          priceUuid: $scope.buyPrice.priceUuid,
          useCurrentPrice: false,
          ip: null
        };
        glideraService.buy($scope.glideraAccessToken, twoFaCode, data, function(err, data) {
          ongoingProcess.set('buyingBitcoin', false);
          return cb(err, data);
        });
      });
    }, 100);
  };

  $scope.sellRequest = function(wallet, twoFaCode, cb) {
    var outputs = [];
    var config = configService.getSync();
    var configWallet = config.wallet;
    var walletSettings = configWallet.settings;

    ongoingProcess.set('creatingTx', true);
    walletService.getAddress(wallet, null, function(err, refundAddress) {
      if (!refundAddress) {
        ongoingProcess.clear();
        popupService.showAlert(gettextCatalog.getString('Error'), bwcError.msg(err, 'Could not create address'));
        return;
      }
      glideraService.getSellAddress($scope.glideraAccessToken, function(err, sellAddress) {
        if (!sellAddress || err) {
          ongoingProcess.clear();
          popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Could not get the destination bitcoin address'));
          return;
        }
        var amount = parseInt(($scope.sellPrice.qty * 100000000).toFixed(0));
        var comment = 'Glidera transaction';

        outputs.push({
          'toAddress': sellAddress,
          'amount': amount,
          'message': comment
        });

        var txp = {
          toAddress: sellAddress,
          amount: amount,
          outputs: outputs,
          message: comment,
          payProUrl: null,
          excludeUnconfirmedUtxos: configWallet.spendUnconfirmed ? false : true,
          feeLevel: walletSettings.feeLevel || 'normal',
          customData: {
            'glideraToken': $scope.glideraAccessToken
          }
        };

        walletService.createTx(wallet, txp, function(err, createdTxp) {
          ongoingProcess.clear();
          if (err) {
            popupService.showAlert(gettextCatalog.getString('Error'), err.message || bwcError.msg(err));
            return;
          }
          walletService.prepare(wallet, function(err, password) {
            if (err) {
              ongoingProcess.clear();
              popupService.showAlert(gettextCatalog.getString('Error'), err.message || bwcError.msg(err));
              return;
            }
            ongoingProcess.set('signingTx', true);
            walletService.publishTx(wallet, createdTxp, function(err, publishedTxp) {
              if (err) {
                ongoingProcess.clear();
                popupService.showAlert(gettextCatalog.getString('Error'), err.message ||  bwcError.msg(err));
                return;
              }

              walletService.signTx(wallet, publishedTxp, password, function(err, signedTxp) {
                if (err) {
                  ongoingProcess.clear();
                  popupService.showAlert(gettextCatalog.getString('Error'), err.message ||  bwcError.msg(err));
                  walletService.removeTx(wallet, signedTxp, function(err) {
                    if (err) $log.debug(err);
                  });
                  return;
                }
                var rawTx = signedTxp.raw;
                var data = {
                  refundAddress: refundAddress,
                  signedTransaction: rawTx,
                  priceUuid: $scope.sellPrice.priceUuid,
                  useCurrentPrice: $scope.sellPrice.priceUuid ? false : true,
                  ip: null
                };
                ongoingProcess.set('sellingBitcoin', true);
                glideraService.sell($scope.glideraAccessToken, twoFaCode, data, function(err, data) {
                  ongoingProcess.clear();
                  if (err) {
                    popupService.showAlert(gettextCatalog.getString('Error'), err.message ||  bwcError.msg(err));
                    return;
                  }
                  return cb(err, data)
                });
              });
            });
          });
        });
      });
    });
  }

  $scope.getBuyPrice = function() {
    var satToBtc = 1 / 100000000;
    var price = {};
    price.qty = (toAmount * satToBtc).toFixed(8);
    glideraService.buyPrice($scope.glideraAccessToken, price, function(err, buyPrice) {
      if (err) {
        popupService.showAlert(gettextCatalog.getString('Error'), 'Could not get exchange information. Please, try again');
        return;
      }
      $scope.buyPrice = buyPrice;
    });
  };

  $scope.getSellPrice = function() {
    var satToBtc = 1 / 100000000;
    var price = {};
    price.qty = (toAmount * satToBtc).toFixed(8);

    glideraService.sellPrice($scope.glideraAccessToken, price, function(err, sellPrice) {
      if (err) {
        popupService.showAlert(gettextCatalog.getString('Error'), 'Could not get exchange information. Please, try again');
        return;
      }
      $scope.sellPrice = sellPrice;
    });
  };

  function publishAndSign(wallet, txp, onSendStatusChange) {

    if (!wallet.canSign() && !wallet.isPrivKeyExternal()) {
      $log.info('No signing proposal: No private key');

      return walletService.onlyPublish(wallet, txp, function(err) {
        if (err) setSendError(err);
      }, onSendStatusChange);
    }

    walletService.publishAndSign(wallet, txp, function(err, txp) {
      if (err) return setSendError(err);

      var previousView = $ionicHistory.viewHistory().backView && $ionicHistory.viewHistory().backView.stateName;
      var fromAmazon = previousView.match(/tabs.giftcards.amazon/) ? true : false;
      if (fromAmazon) {
        var count = 0;
        var invoiceId = JSON.parse($scope.paypro.merchant_data).invoiceId;
        var dataSrc = {
          currency: 'USD',
          amount: giftCardAmountUSD,
          uuid: giftCardUUID,
          accessKey: giftCardAccessKey,
          invoiceId: invoiceId,
          invoiceUrl: $scope.paypro.url,
          invoiceTime: giftCardInvoiceTime
        };
        ongoingProcess.set('creatingGiftCard', true);
        debounceCreate(count, dataSrc, onSendStatusChange);
      }
    }, onSendStatusChange);
  };

  var debounceCreate = lodash.throttle(function(count, dataSrc) {
    debounceCreateGiftCard(count, dataSrc);
  }, 8000, {
    'leading': true
  });

  var debounceCreateGiftCard = function(count, dataSrc, onSendStatusChange) {
    amazonService.createGiftCard(dataSrc, function(err, giftCard) {
      $log.debug("creating gift card " + count);
      if (err) {
        giftCard = {};
        giftCard.status = 'FAILURE';
        popupService.showAlert(gettextCatalog.getString('Error'), err);
      }

      if (giftCard.status == 'PENDING' && count < 3) {
        $log.debug("pending gift card not available yet");
        debounceCreate(count + 1, dataSrc);
        return;
      }

      var now = moment().unix() * 1000;

      var newData = giftCard;
      newData['invoiceId'] = dataSrc.invoiceId;
      newData['accessKey'] = dataSrc.accessKey;
      newData['invoiceUrl'] = dataSrc.invoiceUrl;
      newData['amount'] = dataSrc.amount;
      newData['date'] = dataSrc.invoiceTime || now;
      newData['uuid'] = dataSrc.uuid;

      if (newData.status == 'expired') {
        amazonService.savePendingGiftCard(newData, {
          remove: true
        }, function(err) {
          $log.error(err);
          return;
        });
      }

      amazonService.savePendingGiftCard(newData, null, function(err) {
        ongoingProcess.set('creatingGiftCard', false);
        $log.debug("Saving new gift card with status: " + newData.status);
        $scope.amazonGiftCard = newData;
      });
    });
  };

  $scope.getRates = function() {
    var config = configService.getSync().wallet.settings;
    var unitName = config.unitName;
    var alternativeIsoCode = config.alternativeIsoCode;
    bitpayCardService.getRates(alternativeIsoCode, function(err, res) {
      if (err) {
        $log.warn(err);
        return;
      }
      if (lodash.isEmpty(res)) return;
      if (unitName == 'bits') {
        $scope.exchangeRate = '1,000,000 bits ~ ' + res.rate + ' ' + alternativeIsoCode;
      } else {
        $scope.exchangeRate = '1 BTC ~ ' + res.rate + ' ' + alternativeIsoCode;
      }
    });
  };
});
