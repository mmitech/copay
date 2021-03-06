'use strict';

angular.module('copayApp.controllers').controller('tabHomeController',
  function($rootScope, $timeout, $scope, $state, $stateParams, $ionicModal, $ionicScrollDelegate, $window, gettextCatalog, lodash, popupService, ongoingProcess, externalLinkService, latestReleaseService, profileService, walletService, configService, $log, platformInfo, storageService, txpModalService, appConfigService, bitpayCardService, startupService, addressbookService, feedbackService, bwcError, coinbaseService) {
    var wallet;
    var listeners = [];
    var notifications = [];
    $scope.externalServices = {};
    $scope.openTxpModal = txpModalService.open;
    $scope.version = $window.version;
    $scope.name = appConfigService.nameCase;
    $scope.homeTip = $stateParams.fromOnboarding;
    $scope.isCordova = platformInfo.isCordova;
    $scope.isAndroid = platformInfo.isAndroid;
    $scope.isNW = platformInfo.isNW;
    $scope.showRateCard = {};

    $scope.$on("$ionicView.afterEnter", function() {
      startupService.ready();
    });

    $scope.$on("$ionicView.beforeEnter", function(event, data) {
      if (!$scope.homeTip) {
        storageService.getHomeTipAccepted(function(error, value) {
          $scope.homeTip = (value == 'accepted') ? false : true;
        });
      }

      if ($scope.isNW) {
        latestReleaseService.checkLatestRelease(function(err, newRelease) {
          if (err) {
            $log.warn(err);
            return;
          }

          if (newRelease) $scope.newRelease = true;
        });
      }

      storageService.getFeedbackInfo(function(error, info) {
        if (!info) {
          initFeedBackInfo();
        } else {
          var feedbackInfo = JSON.parse(info);
          //Check if current version is greater than saved version
          var currentVersion = $scope.version;
          var savedVersion = feedbackInfo.version;
          var isVersionUpdated = feedbackService.isVersionUpdated(currentVersion, savedVersion);
          if (!isVersionUpdated) {
            initFeedBackInfo();
            return;
          }
          var now = moment().unix();
          var timeExceeded = (now - feedbackInfo.time) >= 24 * 7 * 60 * 60;
          $scope.showRateCard.value = timeExceeded && !feedbackInfo.sent;
          $timeout(function() {
            $scope.$apply();
          });
        }
      });

      function initFeedBackInfo() {
        var feedbackInfo = {};
        feedbackInfo.time = moment().unix();
        feedbackInfo.version = $scope.version;
        feedbackInfo.sent = false;
        storageService.setFeedbackInfo(JSON.stringify(feedbackInfo), function() {
          $scope.showRateCard.value = false;
        });
      };
    });

    $scope.$on("$ionicView.enter", function(event, data) {
      updateAllWallets();

      addressbookService.list(function(err, ab) {
        if (err) $log.error(err);
        $scope.addressbook = ab || {};
      });

      listeners = [
        $rootScope.$on('bwsEvent', function(e, walletId, type, n) {
          var wallet = profileService.getWallet(walletId);
          updateWallet(wallet);
          if ($scope.recentTransactionsEnabled) getNotifications();
          if (type == 'NewBlock' && n && n.data && n.data.network == 'livenet') {
            // Update Coinbase
            coinbaseService.updatePendingTransactions();
          }
        }),
        $rootScope.$on('Local/TxAction', function(e, walletId) {
          $log.debug('Got action for wallet ' + walletId);
          var wallet = profileService.getWallet(walletId);
          updateWallet(wallet);
          if ($scope.recentTransactionsEnabled) getNotifications();
        })
      ];

      configService.whenAvailable(function() {
        nextStep(function() {
          var config = configService.getSync();
          var isWindowsPhoneApp = platformInfo.isWP && platformInfo.isCordova;

          $scope.glideraEnabled = config.glidera.enabled && !isWindowsPhoneApp;
          $scope.coinbaseEnabled = config.coinbase.enabled && !isWindowsPhoneApp;
          $scope.amazonEnabled = config.amazon.enabled;
          $scope.bitpayCardEnabled = config.bitpayCard.enabled;

          var buyAndSellEnabled = !$scope.externalServices.BuyAndSell && ($scope.glideraEnabled || $scope.coinbaseEnabled);
          var amazonEnabled = !$scope.externalServices.AmazonGiftCards && $scope.amazonEnabled;
          var bitpayCardEnabled = !$scope.externalServices.BitpayCard && $scope.bitpayCardEnabled;

          $scope.nextStepEnabled = buyAndSellEnabled || amazonEnabled || bitpayCardEnabled;
          $scope.recentTransactionsEnabled = config.recentTransactions.enabled;

          if ($scope.recentTransactionsEnabled) getNotifications();

          if ($scope.bitpayCardEnabled) bitpayCardCache();
          $timeout(function() {
            $ionicScrollDelegate.resize();
            $scope.$apply();
          }, 10);
        });
      });
    });

    $scope.$on("$ionicView.leave", function(event, data) {
      lodash.each(listeners, function(x) {
        x();
      });
    });

    $scope.createdWithinPastDay = function(time) {
      var now = new Date();
      var date = new Date(time * 1000);
      return (now.getTime() - date.getTime()) < (1000 * 60 * 60 * 24);
    };

    $scope.openExternalLink = function() {
      var url = 'https://github.com/bitpay/copay/releases/latest';
      var optIn = true;
      var title = gettextCatalog.getString('Update Available');
      var message = gettextCatalog.getString('An update to this app is available. For your security, please update to the latest version.');
      var okText = gettextCatalog.getString('View Update');
      var cancelText = gettextCatalog.getString('Go Back');
      externalLinkService.open(url, optIn, title, message, okText, cancelText);
    };

    $scope.openNotificationModal = function(n) {
      wallet = profileService.getWallet(n.walletId);

      if (n.txid) {
        $state.transitionTo('tabs.wallet.tx-details', {
          txid: n.txid,
          walletId: n.walletId
        });
      } else {
        var txp = lodash.find($scope.txps, {
          id: n.txpId
        });
        if (txp) {
          txpModalService.open(txp);
        } else {
          ongoingProcess.set('loadingTxInfo', true);
          walletService.getTxp(wallet, n.txpId, function(err, txp) {
            var _txp = txp;
            ongoingProcess.set('loadingTxInfo', false);
            if (err) {
              $log.warn('No txp found');
              return popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Transaction not found'));
            }
            txpModalService.open(_txp);
          });
        }
      }
    };

    $scope.openWallet = function(wallet) {
      if (!wallet.isComplete()) {
        return $state.go('tabs.copayers', {
          walletId: wallet.credentials.walletId
        });
      }

      $state.go('tabs.wallet', {
        walletId: wallet.credentials.walletId
      });
    };

    var updateTxps = function() {
      profileService.getTxps({
        limit: 3
      }, function(err, txps, n) {
        if (err) $log.error(err);
        $scope.txps = txps;
        $scope.txpsN = n;
        $timeout(function() {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);
      })
    };

    var updateAllWallets = function() {
      $scope.wallets = profileService.getWallets();
      if (lodash.isEmpty($scope.wallets)) return;

      var i = $scope.wallets.length;
      var j = 0;
      var timeSpan = 60 * 60 * 24 * 7;

      lodash.each($scope.wallets, function(wallet) {
        walletService.getStatus(wallet, {}, function(err, status) {
          if (err) {

            wallet.error = (err === 'WALLET_NOT_REGISTERED') ? gettextCatalog.getString('Wallet not registered') :  bwcError.msg(err);

            $log.error(err);
          } else {
            wallet.error = null;
            wallet.status = status;
          }
          if (++j == i) {
            updateTxps();
          }
        });
      });
    };

    var updateWallet = function(wallet) {
      $log.debug('Updating wallet:' + wallet.name)
      walletService.getStatus(wallet, {}, function(err, status) {
        if (err) {
          $log.error(err);
          return;
        }
        wallet.status = status;
        updateTxps();
      });
    };

    var getNotifications = function() {
      profileService.getNotifications({
        limit: 3
      }, function(err, notifications, total) {
        if (err) {
          $log.error(err);
          return;
        }
        $scope.notifications = notifications;
        $scope.notificationsN = total;
        $timeout(function() {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);
      });
    };

    $scope.hideHomeTip = function() {
      storageService.setHomeTipAccepted('accepted', function() {
        $scope.homeTip = false;
        $timeout(function() {
          $scope.$apply();
        })
      });
    };

    var nextStep = function(cb) {
      var i = 0;
      var services = ['AmazonGiftCards', 'BitpayCard', 'BuyAndSell'];
      lodash.each(services, function(service) {
        storageService.getNextStep(service, function(err, value) {
          $scope.externalServices[service] = value == 'true' ? true : false;
          if (++i == services.length) return cb();
        });
      });
    };

    $scope.shouldHideNextSteps = function() {
      $scope.hideNextSteps = !$scope.hideNextSteps;
      $timeout(function() {
        $ionicScrollDelegate.resize();
        $scope.$apply();
      }, 10);
    };

    var bitpayCardCache = function() {
      bitpayCardService.getBitpayDebitCards(function(err, data) {
        if (err) return;
        if (lodash.isEmpty(data)) {
          $scope.bitpayCards = null;
          return;
        }
        $scope.bitpayCards = data;
      });
      bitpayCardService.getBitpayDebitCardsHistory(null, function(err, data) {
        if (err) return;
        if (lodash.isEmpty(data)) {
          $scope.cardsHistory = null;
          return;
        }
        $scope.cardsHistory = data;
      });
    };

    $scope.onRefresh = function() {
      $timeout(function() {
        $scope.$broadcast('scroll.refreshComplete');
      }, 300);
      updateAllWallets();
    };
  });
