import { Router, type IRouter } from "express";
import cafeRouter from "./cafe";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cafeRouter);

export default router;
