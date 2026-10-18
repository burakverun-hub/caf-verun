import { Router, type IRouter } from "express";
import adminCatalogRouter from "./admin-catalog";
import adminRouter from "./admin";
import authRouter from "./auth";
import healthRouter from "./health";
import managerRouter from "./manager";
import ordersRouter from "./orders";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);
router.use(ordersRouter);
router.use(adminRouter);
router.use(adminCatalogRouter);
router.use(managerRouter);

export default router;
