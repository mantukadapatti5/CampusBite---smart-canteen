const express = require('express');
const router = express.Router();
const tx = require('../controllers/transactionController');
const { authenticate, authorize } = require('../middleware/auth');

router.get('/mine', authenticate, tx.mine);
router.get('/mine/summary', authenticate, tx.mySummary);
router.get('/summary', authenticate, authorize('manager', 'admin'), tx.summary);
router.get('/export', authenticate, authorize('manager', 'admin'), tx.exportCsv);
router.get('/', authenticate, authorize('manager', 'admin'), tx.all);
router.get('/:id(\\d+)', authenticate, tx.getOne);

module.exports = router;
