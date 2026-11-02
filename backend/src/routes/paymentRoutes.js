const express = require('express');
const router = express.Router();
const pay = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Demo UPI gateway - opened by scanning the QR code, no login needed (the secret token in the link is the credential)
router.get('/pay/:token', pay.gatewayInfo);
router.post('/pay/:token/confirm', pay.gatewayConfirm);
router.post('/pay/:token/fail', pay.gatewayFail);

router.post('/quote', authenticate, pay.quote);
router.post('/checkout', authenticate, pay.checkout);
router.post('/topup', authenticate, pay.topup);
router.get('/:id(\\d+)', authenticate, pay.getPayment);
router.post('/:id(\\d+)/cancel', authenticate, pay.cancelPayment);

module.exports = router;
