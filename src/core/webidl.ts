export function requiredArguments(
    length: number,
    required: number,
    prefix: string,
) {
    if (length < required) {
        const errMsg = `${prefix ? prefix + ': ' : ''}${required} argument${
            required === 1 ? '' : 's'
        } required, but only ${length} present`;
        throw new TypeError(errMsg);
    }
}
