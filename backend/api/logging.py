import json
import logging

# Attributes every LogRecord has. Anything else on a record was passed by the
# caller through `extra=` and belongs in the output.
_STANDARD = set(vars(logging.makeLogRecord({}))) | {'message', 'asctime'}


class JsonFormatter(logging.Formatter):
    """One JSON object per line: timestamp, level, logger, event, then fields.

    Call sites log an event name and pass the details as `extra`:

        logger.info('pms.import.finished', extra={'transactions_created': 12})
    """

    def format(self, record):
        entry = {
            'timestamp': self.formatTime(record, '%Y-%m-%dT%H:%M:%S%z'),
            'level': record.levelname,
            'logger': record.name,
            'event': record.getMessage(),
        }
        entry.update({key: value for key, value in vars(record).items() if key not in _STANDARD})
        if record.exc_info:
            entry['exception'] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


class KeyValueFormatter(logging.Formatter):
    """The same events for a human at a terminal: `event key=value ...`."""

    def format(self, record):
        fields = ' '.join(
            f'{key}={value}' for key, value in vars(record).items() if key not in _STANDARD
        )
        line = f'{record.levelname} {record.name} {record.getMessage()} {fields}'.rstrip()
        if record.exc_info:
            line += '\n' + self.formatException(record.exc_info)
        return line
