import XCTest

final class InfinitoolsUITests: XCTestCase {
    @MainActor
    func testSearchFavoritesAndSettings() throws {
        let app = XCUIApplication(); app.launchEnvironment["INFINITOOLS_UNIT_TEST_HOST"] = "0"; app.launch()
        XCTAssertTrue(app.tabBars.buttons["Ferramentas"].waitForExistence(timeout: 20))
        app.swipeDown()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        search.tap(); search.typeText("Juntar PDF")
        let favorite = app.buttons["Adicionar Juntar PDF aos favoritos"]
        if favorite.waitForExistence(timeout: 10) { favorite.tap() }
        app.tabBars.buttons["Favoritos"].tap()
        XCTAssertTrue(app.buttons["Remover Juntar PDF dos favoritos"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Arquivos"].tap()
        XCTAssertTrue(app.staticTexts["Seus resultados aparecem aqui"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Ajustes"].tap()
        XCTAssertTrue(app.staticTexts["158"].waitForExistence(timeout: 10))
        app.buttons["Limpar histórico de ferramentas"].tap()
        app.buttons["Limpar"].tap()
    }
}
