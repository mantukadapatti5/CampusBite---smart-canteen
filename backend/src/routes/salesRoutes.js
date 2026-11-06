const express = require('express');
const router = express.Router();
const sales = require('../controllers/salesController');
const { authenticate, authorize } = require('../middleware/auth');

// Manager portal -> Sales & Orders (admins can open it too). Students and kitchen staff get 403.
router.use(authenticate, authorize('manager', 'admin'));

router.get('/summary', sales.summary);
router.get('/orders', sales.orders);
router.get('/export', sales.exportCsv);

module.exports = router;
