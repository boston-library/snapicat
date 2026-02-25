import azure.functions as func
from azure.functions import FunctionApp, AuthLevel

app = FunctionApp(http_auth_level=AuthLevel.FUNCTION)

@app.function_name(name="search_books")
@app.route(route="search_books", methods=["POST"])
async def search_books(req: func.HttpRequest) -> func.HttpResponse:
    from src.search_books.handler import main
    return await main(req)

@app.function_name(name="generate_xml")
@app.route(route="generate_xml", methods=["POST"])
async def generate_xml(req: func.HttpRequest) -> func.HttpResponse:
    from src.generate_xml.handler import main
    return await main(req)
