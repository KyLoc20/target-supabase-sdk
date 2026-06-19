export default {
    taskParamsValidator(params) {
        return params != null && typeof params === "object";
    },
    async taskFn(params) {
        return {
            isSuccess: true,
            cost: 0,
            extra: params,
        };
    },
};
