import { Router } from 'express'
import * as dashboardController from '../controllers/dashboard.controller'

const router = Router()

router.get('/daily', dashboardController.getDaily)
router.get('/by-country', dashboardController.getByCountry)
router.get('/by-adset', dashboardController.getByAdSet)

export default router
