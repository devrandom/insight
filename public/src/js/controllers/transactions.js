'use strict';

angular.module('insight.transactions').controller('transactionsController',
function($q, $http, $scope, $rootScope, $routeParams, $location, Global, Transaction, TransactionsByBlock, TransactionsByAddress) {
  $scope.global = Global;
  $scope.loading = false;
  $scope.loadedBy = null;

  var pageNum = 0;
  var pagesTotal = 1;
  var COIN = 100000000;

  var _aggregateItems = function(items) {
    if (!items) return [];

    var l = items.length;

    var ret = [];
    var tmp = {};
    var u = 0;

    for(var i=0; i < l; i++) {

      var notAddr = false;
      // non standard input
      if (items[i].scriptSig && !items[i].addr) {
        items[i].addr = 'Unparsed address [' + u++ + ']';
        items[i].notAddr = true;
        notAddr = true;
      }

      // non standard output
      if (items[i].scriptPubKey && !items[i].scriptPubKey.addresses) {
        items[i].scriptPubKey.addresses = ['Unparsed address [' + u++ + ']'];
        items[i].notAddr = true;
        notAddr = true;
      }

      // multiple addr at output
      if (items[i].scriptPubKey && items[i].scriptPubKey.addresses.length > 1) {
        items[i].addr = items[i].scriptPubKey.addresses.join(',');
        ret.push(items[i]);
        continue;
      }

      var addr = items[i].addr || (items[i].scriptPubKey && items[i].scriptPubKey.addresses[0]);

      if (!tmp[addr]) {
        tmp[addr] = {};
        tmp[addr].valueSat = 0;
        tmp[addr].count = 0;
        tmp[addr].addr = addr;
        tmp[addr].items = [];
      }
      if ('smartaddr' in items[i]) {
        tmp[addr].smartaddr = items[i].smartaddr;
        tmp[addr].smartqty = items[i].smartqty;
      }

      tmp[addr].isSpent = items[i].spentTxId;

      tmp[addr].doubleSpentTxID = tmp[addr].doubleSpentTxID   || items[i].doubleSpentTxID;
      tmp[addr].doubleSpentIndex = tmp[addr].doubleSpentIndex || items[i].doubleSpentIndex;
      tmp[addr].unconfirmedInput += items[i].unconfirmedInput;
      tmp[addr].dbError = tmp[addr].dbError || items[i].dbError;
      tmp[addr].valueSat += Math.round(items[i].value * COIN);
      tmp[addr].items.push(items[i]);
      tmp[addr].notAddr = notAddr;
      tmp[addr].count++;
    }

    angular.forEach(tmp, function(v) {
      v.value    = v.value || parseInt(v.valueSat) / COIN;
      ret.push(v);
    });
    return ret;
  };

  var _processTX = function(tx) {
    tx.vinSimple = _aggregateItems(tx.vin);
    tx.voutSimple = _aggregateItems(tx.vout);
  };

  var _paginate = function(data) {
    $scope.loading = false;

    pagesTotal = data.pagesTotal;
    pageNum += 1;

    data.txs.forEach(function(tx) {
      _processTX(tx);
      $scope.txs.push(tx);
    });
  };

  var _byBlock = function() {
    TransactionsByBlock.get({
      block: $routeParams.blockHash,
      pageNum: pageNum
    }, function(data) {
      _paginate(data);
    });
  };

  var _byAddress = function () {
    TransactionsByAddress.get({
      address: $routeParams.addrStr,
      pageNum: pageNum
    }, function(data) {
      var all = [];
      data.txs.forEach(function(tx) {
        all.push(_augmentTx(tx));
      })
      $q.all(all).then(function() { _paginate(data); });
    });
  };

  var _cdmap = {
    'fba87447fdcff5bc4ac0cff6336b5eb5a8defbfceb0f03f3f8b99c78143aa5f6': 'USD',
    'df8a21d38c0642d0ec203fe76805b952eb4810e93ffba93e0dcef8cd013bb5ea': 'EUR',
    '6bcb8afbf949990c1ee3ab175af8d2dac6ecf147f42c6014d726d308e8caa5c9': 'Gold',
    'a4882cfa917048625e78d46846b0e50f6502e2c674eb125ad0d8b5cdf70efa11': 'Oil'};
  var _augmentTx = function(tx, f) {
    var host = window.location.hostname;
    if (host == '192.168.56.101') host = '127.0.0.1';
    var deferral = $q.defer();
    $http.get('http://' + host + ':8888/explore/transaction/' + tx.txid).then(function(aux){
      for (defi = 0 ; defi < aux.data.colordefs.length ; defi++) {
        def = aux.data.colordefs[defi];
        tx.cdhash = def.cdhash;
        tx.cdname = _cdmap[def.cdhash];

        for (i = 0 ; i < tx.vin.length ; i++) {
          if (i < def.srcaddrs.length && 'smartaddr' in def.srcaddrs[i])
            tx.vin[i].smartaddr = def.srcaddrs[i].smartaddr;
        }
        for (i = 0 ; i < tx.vout.length ; i++) {
          if (i < def.dstaddrs.length && 'smartaddr' in def.dstaddrs[i]) {
            tx.vout[i].smartaddr = def.dstaddrs[i].smartaddr;
            tx.vout[i].smartqty = def.dstaddrs[i].outpoints[0].qty;
          }
        }
      }
      deferral.resolve();
    }, function(aux){
      deferral.resolve();
    });
    return deferral.promise;
  };
  var _findTx = function(txid) {
    Transaction.get({
      txId: txid
    }, function(tx) {
      _augmentTx(tx).then(function() {
        $rootScope.titleDetail = tx.txid.substring(0,7) + '...';
        $rootScope.flashMessage = null;
        $scope.tx = tx;
        _processTX(tx);
        $scope.txs.unshift(tx);
      });
    }, function(e) {
      if (e.status === 400) {
        $rootScope.flashMessage = 'Invalid Transaction ID: ' + $routeParams.txId;
      }
      else if (e.status === 503) {
        $rootScope.flashMessage = 'Backend Error. ' + e.data;
      }
      else {
        $rootScope.flashMessage = 'Transaction Not Found';
      }

      $location.path('/');
    });
  };

  $scope.findThis = function() {
    _findTx($routeParams.txId);
  };

  //Initial load
  $scope.load = function(from) {
    $scope.loadedBy = from;
    $scope.loadMore();
  };

  //Load more transactions for pagination
  $scope.loadMore = function() {
    if (pageNum < pagesTotal && !$scope.loading) {
      $scope.loading = true;

      if ($scope.loadedBy === 'address') {
        _byAddress();
      }
      else {
        _byBlock();
      }
    }
  };

  // Highlighted txout
  if ($routeParams.v_type == '>' || $routeParams.v_type == '<') {
    $scope.from_vin = $routeParams.v_type == '<' ? true : false;
    $scope.from_vout = $routeParams.v_type == '>' ? true : false;
    $scope.v_index = parseInt($routeParams.v_index);
    $scope.itemsExpanded = true;
  }
  
  //Init without txs
  $scope.txs = [];

  $scope.$on('tx', function(event, txid) {
    _findTx(txid);
  });

});

angular.module('insight.transactions').controller('SendRawTransactionController',
  function($scope, $http) {
  $scope.transaction = '';
  $scope.status = 'ready';  // ready|loading|sent|error
  $scope.txid = '';
  $scope.error = null;

  $scope.formValid = function() {
    return !!$scope.transaction;
  };
  $scope.send = function() {
    var postData = {
      rawtx: $scope.transaction
    };
    $scope.status = 'loading';
    $http.post('/api/tx/send', postData)
      .success(function(data, status, headers, config) {
        if(typeof(data.txid) != 'string') {
          // API returned 200 but the format is not known
          $scope.status = 'error';
          $scope.error = 'The transaction was sent but no transaction id was got back';
          return;
        }

        $scope.status = 'sent';
        $scope.txid = data.txid;
      })
      .error(function(data, status, headers, config) {
        $scope.status = 'error';
        if(data) {
          $scope.error = data;
        } else {
          $scope.error = "No error message given (connection error?)"
        }
      });
  };
});
